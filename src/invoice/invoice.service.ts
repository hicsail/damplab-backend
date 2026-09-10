import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Invoice, InvoiceDocument } from './invoice.model';
import { InvoiceKind } from './invoice-kind';
import { CreateInvoiceInput } from './dto/create-invoice.input';
import { JobService } from '../job/job.service';
import { SOWService } from '../sow/sow.service';
import { SowVersionService } from '../sow/sow-version.service';
import { User } from '../auth/user.interface';
import { Role } from '../auth/roles/roles.enum';
import { SOWStatus } from '../sow/sow.model';
import { CHARGE_MESSAGES, JobChargeService, chargeInputError } from '../job-payment/job-charge.service';
import { JobChargeKind } from '../job-payment/job-charge.model';
import { ContractedServiceLine, JobBalanceService, JobChargeBreakdown } from '../job-payment/job-balance.service';
import { NotificationDispatchService } from '../notification/notification-dispatch.service';

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

const COUNTERSIGNED_MESSAGE = 'Cannot generate an invoice until the Statement of Work is countersigned.';
const DEFAULT_DEPOSIT_LABEL = 'Deposit';

/** `YYYY-MM-DD`, the same in a test and on a server in any timezone. */
function isoDay(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * A contracted SOW line in the invoice's `InvoiceServiceLineItem` shape.
 *
 * Read off the countersigned version, so an invoice states the same pricing
 * basis ("$50.00 x 4") the Fee Schedule did. The breakdown fields stay
 * undefined on a legacy line that carries none, rather than inventing a zero.
 */
export function toInvoiceServiceLine({ line, sourceIndex }: ContractedServiceLine): any {
  const serviceId = String(line?.serviceId ?? line?._id ?? '');
  return {
    _id: serviceId,
    serviceId,
    name: String(line?.name ?? 'Service'),
    description: line?.description == null ? '' : String(line.description),
    cost: Number(line?.cost) || 0,
    unitCost: line?.unitCost == null ? undefined : Number(line.unitCost),
    multiplier: line?.multiplier == null ? undefined : Number(line.multiplier),
    runCount: line?.runCount == null ? undefined : Number(line.runCount),
    category: line?.category == null ? '' : String(line.category),
    pricingDetails: Array.isArray(line?.pricingDetails) && line.pricingDetails.length > 0 ? line.pricingDetails : undefined,
    sourceIndex
  };
}

@Injectable()
export class InvoiceService {
  constructor(
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<InvoiceDocument>,
    private readonly jobService: JobService,
    private readonly sowService: SOWService,
    private readonly sowVersionService: SowVersionService,
    private readonly charges: JobChargeService,
    private readonly balances: JobBalanceService,
    private readonly notificationDispatch: NotificationDispatchService
  ) {}

  async findByJobId(jobId: string): Promise<Invoice[]> {
    return this.invoiceModel.find({ jobId }).sort({ createdAt: -1 }).exec();
  }

  async findById(invoiceId: string): Promise<Invoice | null> {
    return this.invoiceModel.findById(invoiceId).exec();
  }

  /**
   * How many invoices **stand** against a job — 1 once one has been issued, 0
   * before that or once it is voided. The jobs list asks this per row, so it
   * never loads the documents.
   *
   * Superseded versions are excluded as well as voided ones: only one invoice
   * stands at a time, and a job reissued three times has not been billed three
   * times.
   *
   * **This deliberately differs from the numbering count inside `createForJob`**,
   * which counts *everything*: a void or a supersede keeps the document and its
   * number, it never frees either one up.
   */
  async countByJobId(jobId: string): Promise<number> {
    return this.invoiceModel.countDocuments({ jobId, voidedAt: null, supersededAt: null }).exec();
  }

  /**
   * Issue a new version of the job's invoice.
   *
   * Every version restates the whole job as it stands: the countersigned SOW's
   * contracted lines and adjustments, confirmed equipment use, custom charges
   * and discounts, the deposit, and the payments received. Issuing one marks
   * every earlier invoice on the job SUPERSEDED, so exactly one stands.
   *
   * The only writes besides the document are the new lines the caller adds —
   * custom lines and the deposit, onto the job's charges, where every later
   * version picks them up. Removing a line is voiding its charge, never
   * something issuing an invoice does.
   */
  async createForJob(input: CreateInvoiceInput, user: User): Promise<Invoice> {
    const roles = user.realm_access?.roles ?? [];
    const isStaff = roles.includes(Role.DamplabStaff);
    if (!isStaff) {
      throw new ForbiddenException('Only staff can generate invoices');
    }

    const job = await this.jobService.findById(input.jobId);
    if (!job) {
      throw new NotFoundException(`Job with ID ${input.jobId} not found`);
    }
    const key = String((job as any)._id);

    // An invoice bills a countersigned document, or nothing — one message for
    // every way that can fail (never sent, cancelled, withdrawn): the action that
    // clears all of them is the same, countersign the SOW. A deposit is no
    // exception; it is asked for once the SOW is agreed.
    const sow: any = await this.sowService.findByJobId(key);
    const active = sow ? await this.sowVersionService.getActiveVersion(String(sow._id)) : null;
    if (!sow || active?.status !== SOWStatus.FINAL) throw new BadRequestException(COUNTERSIGNED_MESSAGE);

    // Every refusal this call can make, decided before a single charge is
    // written: there is no rollback through JobChargeService, so a bad third
    // line must not leave the first two on the job.
    const customLines = input.customLines ?? [];
    for (const line of customLines) {
      const refusal = chargeInputError({ kind: JobChargeKind.CUSTOM, label: line.label, amount: line.amount });
      if (refusal) throw new BadRequestException(refusal);
    }
    const deposit = input.deposit ?? null;
    const depositLabel = String(deposit?.label ?? '').trim() || DEFAULT_DEPOSIT_LABEL;
    if (deposit) {
      const refusal = chargeInputError({ kind: JobChargeKind.DEPOSIT, label: depositLabel, amount: deposit.amount, dueDate: deposit.dueDate });
      if (refusal) throw new BadRequestException(refusal);
      const live = await this.charges.liveByJobId(key);
      if (live.some((c: any) => String(c.kind) === JobChargeKind.DEPOSIT)) throw new BadRequestException(CHARGE_MESSAGES.depositExists);
    }

    for (const line of customLines) {
      await this.charges.addCharge({ jobId: key, kind: JobChargeKind.CUSTOM, label: String(line.label).trim(), amount: Number(line.amount), note: line.note }, user);
    }
    if (deposit) {
      await this.charges.addCharge({ jobId: key, kind: JobChargeKind.DEPOSIT, label: depositLabel, amount: Number(deposit.amount), dueDate: deposit.dueDate }, user);
    }

    // Read after the writes above: the invoice states the job as it stands now.
    const breakdown = await this.balances.chargeBreakdown(key);

    const jobDisplayId = String((job as any).jobId ?? job._id);
    // Counts EVERY document on the job — voided and superseded ones included —
    // so a number is never reused and the version only ever climbs. The unique
    // (jobId, invoiceNumber) index refuses the loser of two concurrent issues.
    const versionNumber = (await this.invoiceModel.countDocuments({ jobId: key }).exec()) + 1;
    const invoiceNumber = `${jobDisplayId}-${pad3(versionNumber)}`;
    const createdBy = user.email || user.preferred_username || 'unknown';
    const invoiceDate = new Date();
    const dueDate = input.dueDate ?? new Date(invoiceDate.getTime() + 30 * 24 * 3_600_000);

    const invoice = await this.invoiceModel.create({
      job: (job as any)._id,
      jobId: key,
      jobDisplayId,
      jobName: (job as any).name ?? '',
      invoiceNumber,
      versionNumber,
      kind: InvoiceKind.STATEMENT,
      invoiceDate,
      createdBy,
      services: breakdown.serviceLines.map(toInvoiceServiceLine),
      adjustments: breakdown.adjustments,
      equipmentLines: this.toEquipmentLines(breakdown.bookings),
      customLines: breakdown.customLines.map((c: any) => ({ chargeId: String(c._id), kind: c.kind, label: c.label, amount: c.amount, note: c.note ?? undefined })),
      deposit: this.toDeposit(breakdown),
      subtotal: breakdown.chargesToDate,
      paymentsToDate: breakdown.paymentsToDate,
      balanceDue: breakdown.balanceDue,
      // What is payable NOW, which is the balance and not the charges — the
      // customer must not be asked twice for what they have already paid.
      totalCost: breakdown.balanceDue,
      dueDate,
      billedToName: String(sow?.clientName ?? 'Client'),
      billedToEmail: String(sow?.clientEmail ?? ''),
      billedToAddress: sow?.clientAddress ?? undefined,
      customerCategory: active?.inputs?.customerCategory ?? (job as any).customerCategory ?? undefined,
      sowVersionNumber: breakdown.sowVersionNumber ?? active.versionNumber,
      createdAt: new Date()
    });

    // After the create, so a refused create supersedes nothing.
    await this.invoiceModel
      .updateMany({ jobId: key, _id: { $ne: (invoice as any)._id }, voidedAt: null, supersededAt: null }, { $set: { supersededAt: new Date(), supersededByNumber: invoiceNumber } })
      .exec();

    this.announceInvoice(invoice, breakdown, dueDate, user);
    return invoice;
  }

  private toDeposit(breakdown: JobChargeBreakdown): any {
    const charge: any = breakdown.depositCharge;
    if (!charge) return undefined;
    return {
      chargeId: String(charge._id),
      label: String(charge.label ?? DEFAULT_DEPOSIT_LABEL),
      amount: breakdown.depositAmount ?? 0,
      dueDate: breakdown.depositDueDate ?? undefined,
      outstanding: breakdown.depositOutstanding
    };
  }

  /** One confirmed booking as the invoice's equipment usage block lists it. */
  private toEquipmentLines(bookings: readonly any[]): any[] {
    return bookings.map((booking: any) => ({
      bookingId: String(booking._id),
      itemName: String(booking.inventoryName ?? 'Equipment'),
      operationLabel: booking.notes ? String(booking.notes) : undefined,
      startTime: booking.startTime ?? undefined,
      endTime: booking.endTime ?? undefined,
      actualHours: booking.actualHours == null ? undefined : Number(booking.actualHours),
      rate: booking.rateSnapshot == null ? undefined : Number(booking.rateSnapshot),
      cost: Number(booking.cost) || 0,
      confirmedAt: booking.usageConfirmedAt ?? undefined
    }));
  }

  /**
   * Tell the job owner a new invoice exists, what it asks for, and by when.
   * Fire-and-forget — NotificationDispatchService never throws.
   */
  private announceInvoice(invoice: any, breakdown: JobChargeBreakdown, dueDate: Date, user: User): void {
    const label = `Invoice ${invoice.jobDisplayId} · v${invoice.versionNumber}`;
    const amountDue = Number(breakdown.balanceDue || 0);
    const due = amountDue > 0 ? `Amount due: $${amountDue.toFixed(2)}, by ${isoDay(dueDate)}.` : 'Nothing is due: the payments received cover it.';
    const deposit = breakdown.depositOutstanding > 0 && breakdown.depositDueDate ? ` A deposit of $${breakdown.depositOutstanding.toFixed(2)} is due by ${isoDay(breakdown.depositDueDate)}.` : '';
    this.notificationDispatch.dispatch({
      eventType: 'INVOICE_ISSUED',
      title: `${label} issued`,
      message: `${label} for job "${invoice.jobName || invoice.jobDisplayId}" has been issued. ${due}${deposit}`,
      jobId: String(invoice.jobId),
      actorSub: user.sub,
      actorDisplayName: user.preferred_username ?? user.email ?? undefined
    });
  }

  /**
   * Void the job's current invoice: keep the document, change nothing else.
   *
   * There is deliberately no delete. See the comment on `Invoice.voidedAt` —
   * removing a document would recycle its invoice number, because numbering is
   * derived from `countDocuments`.
   *
   * For a job that was cancelled or changed: the job's charges and payments stay
   * as they are, and nothing stands until a new version is issued. A superseded
   * invoice is refused — it is already not payable, and voiding it would say
   * nothing the history does not.
   *
   * Idempotence is refused rather than silently accepted: voiding an already-void
   * invoice almost always means someone is looking at a stale list, and the second
   * void would overwrite the first reason and actor. Authorization lives on the
   * resolver (`@RequirePermission(Permission.BillingWrite)`), which is where the
   * rest of the backend puts it.
   */
  async voidInvoice(invoiceId: string, reason: string, user: User): Promise<Invoice> {
    const trimmed = String(reason ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('A reason is required to void an invoice.');
    }

    const invoice = await this.invoiceModel.findById(invoiceId).exec();
    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${invoiceId} not found`);
    }
    if ((invoice as any).voidedAt) {
      throw new BadRequestException(`Invoice ${(invoice as any).invoiceNumber} has already been voided.`);
    }
    if ((invoice as any).supersededAt) {
      throw new BadRequestException(
        `Invoice ${(invoice as any).invoiceNumber} has been superseded by ${(invoice as any).supersededByNumber ?? 'a newer version'}. Only the current invoice can be voided.`
      );
    }

    const voidedBy = user.email || user.preferred_username || 'unknown';
    // Conditional on still standing, so two staff voiding at once cannot
    // overwrite each other's reason, and an issue landing in between is not
    // voided by a stale click — the loser gets a refusal, not a silent write.
    const updated = await this.invoiceModel
      .findOneAndUpdate({ _id: invoiceId, voidedAt: null, supersededAt: null }, { $set: { voidedAt: new Date(), voidedBy, voidReason: trimmed } }, { new: true })
      .exec();
    if (!updated) {
      throw new BadRequestException(`Invoice ${(invoice as any).invoiceNumber} is no longer the current invoice.`);
    }
    return updated;
  }
}
