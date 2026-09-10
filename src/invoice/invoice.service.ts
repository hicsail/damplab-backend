import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Invoice, InvoiceDocument } from './invoice.model';
import { InvoiceKind } from './invoice-kind';
import { CreateInvoiceInput } from './dto/create-invoice.input';
import { buildStatementServiceLines } from './statement-lines';
import { JobService } from '../job/job.service';
import { SOWService } from '../sow/sow.service';
import { SowVersionService } from '../sow/sow-version.service';
import { User } from '../auth/user.interface';
import { Role } from '../auth/roles/roles.enum';
import { SOWStatus } from '../sow/sow.model';
import { JobChargeService } from '../job-payment/job-charge.service';
import { JobBalanceService } from '../job-payment/job-balance.service';
import { NotificationDispatchService } from '../notification/notification-dispatch.service';

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

const COUNTERSIGNED_MESSAGE = 'Cannot generate an invoice until the Statement of Work is countersigned.';

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
   * How many invoices **stand** against a job. The jobs list asks this per row, so
   * it never loads the documents.
   *
   * Voided invoices are excluded, because the only question this answers is
   * "has this job been billed yet" — and a job whose one invoice was voided has
   * not.
   *
   * **This deliberately differs from the numbering count inside `createForJob`**,
   * which counts *everything*: a void keeps the document and its number, it never
   * frees either one up.
   */
  async countByJobId(jobId: string): Promise<number> {
    return this.invoiceModel.countDocuments({ jobId, voidedAt: null }).exec();
  }

  /**
   * Issue a job's statement of account.
   *
   * One document, replacing the old SOW invoice and the running equipment
   * invoice: it releases whatever service lines the caller listed onto the
   * job's charge ledger, then states everything the ledger now holds — released
   * service lines, prorated adjustments, confirmed equipment use, custom
   * charges and live deposits — against what has been paid.
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
    // every way that can fail. Unlike the old per-reason gate, a statement never
    // distinguishes "never sent" from "cancelled" from "withdrawn": the action
    // that clears all of them is the same, countersign the SOW, so naming the
    // reason only gave staff more ways to misread it as a permanent refusal.
    const sow: any = await this.sowService.findByJobId(input.jobId);
    if (!sow) throw new BadRequestException(COUNTERSIGNED_MESSAGE);
    const active = await this.sowVersionService.getActiveVersion(String(sow._id));
    if (active?.status !== SOWStatus.FINAL) throw new BadRequestException(COUNTERSIGNED_MESSAGE);

    // What this statement may release, and what the staff dialog listed — one
    // array, so a position means the same thing on both sides.
    const sowServices: any[] = await this.sowService.billableServiceLines(sow);

    // Release, before the balance is computed: the statement states what the
    // ledger holds AFTER this release, not before it.
    const live = await this.charges.liveByJobId(key);
    const liveIndexes = new Set<number>(live.filter((c: any) => String(c.kind) === 'SERVICE_LINE' && typeof c.sourceIndex === 'number').map((c: any) => Number(c.sourceIndex)));
    const toRelease: Array<{ serviceId: string; label: string; amount: number; sowVersionNumber?: number; sourceIndex: number }> = [];
    for (const selection of input.releaseServiceLines ?? []) {
      const sourceIndex = Number(selection.sourceIndex);
      // Already live FIRST. A dialog locks released lines checked, so it resends
      // positions a newer SOW version may no longer carry; validating those would
      // make the statement un-issuable for a rule that has nothing to enforce.
      if (liveIndexes.has(sourceIndex)) continue;
      const line = sowServices[sourceIndex];
      if (!line || String(line.serviceId ?? line._id ?? '') !== String(selection.serviceId)) {
        throw new BadRequestException('Selected line is not on the Statement of Work.');
      }
      liveIndexes.add(sourceIndex);
      toRelease.push({
        serviceId: String(line.serviceId ?? line._id),
        label: String(line.name ?? 'Service'),
        amount: Number(line.cost) || 0,
        sowVersionNumber: active?.versionNumber ?? undefined,
        sourceIndex
      });
    }
    if (toRelease.length > 0) await this.charges.createServiceLineCharges(key, toRelease, user);

    const breakdown = await this.balances.chargeBreakdown(key);
    if (breakdown.chargesToDate <= 0 && breakdown.paymentsToDate <= 0) {
      // Hours confirmed against an operation whose service has no price sum to
      // nothing — say that, not "nothing to invoice", or the lab looks for a
      // booking to confirm that is already confirmed.
      if (breakdown.confirmedHours > 0) {
        throw new BadRequestException("Confirmed usage on this job has no rate. Set a price for the operation's service and confirm the usage again.");
      }
      throw new BadRequestException('Nothing to invoice yet.');
    }

    const jobDisplayId = String((job as any).jobId ?? job._id);
    const invoiceNumber = await this.nextInvoiceNumber(key, jobDisplayId);
    const createdBy = user.email || user.preferred_username || 'unknown';
    const invoiceDate = new Date();
    const dueDate = input.dueDate ?? new Date(invoiceDate.getTime() + 30 * 24 * 3_600_000);

    const invoice = await this.invoiceModel.create({
      job: (job as any)._id,
      jobId: key,
      jobDisplayId,
      jobName: (job as any).name ?? '',
      invoiceNumber,
      kind: InvoiceKind.STATEMENT,
      invoiceDate,
      createdBy,
      services: buildStatementServiceLines(breakdown.serviceLines, sowServices),
      adjustments: breakdown.adjustments,
      equipmentLines: this.toEquipmentLines(breakdown.bookings),
      customLines: [...breakdown.customLines, ...breakdown.depositLines].map((c: any) => ({ chargeId: String(c._id), kind: c.kind, label: c.label, amount: c.amount })),
      subtotal: breakdown.chargesToDate,
      paymentsToDate: breakdown.paymentsToDate,
      balanceDue: breakdown.balanceDue,
      // What is payable NOW, which for a running statement is the balance and
      // not the charges — the customer must not be asked twice for what they
      // have already paid.
      totalCost: breakdown.balanceDue,
      dueDate,
      billedToName: String((sow as any).clientName ?? 'Client'),
      billedToEmail: String((sow as any).clientEmail ?? ''),
      billedToAddress: (sow as any).clientAddress ?? undefined,
      customerCategory: active?.inputs?.customerCategory ?? (job as any).customerCategory ?? undefined,
      sowVersionNumber: active?.versionNumber ?? undefined,
      createdAt: new Date()
    });

    this.announceInvoice(invoice, breakdown.balanceDue, dueDate, user);
    return invoice;
  }

  /**
   * The next number in the job's `<jobDisplayId>-NNN` series.
   *
   * Counts EVERY invoice on the job, voided ones included: a void keeps the
   * document and its number, it never frees either up.
   */
  private async nextInvoiceNumber(jobId: string, jobDisplayId: string): Promise<string> {
    const existingCount = await this.invoiceModel.countDocuments({ jobId }).exec();
    return `${jobDisplayId}-${pad3(existingCount + 1)}`;
  }

  /** The mapper a running equipment statement used, kept verbatim for STATEMENT documents. */
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
   * Tell the job owner an invoice exists, what it asks for, and by when.
   * Fire-and-forget — NotificationDispatchService never throws.
   *
   * The date is rendered with `toISOString().slice(0, 10)`, not a locale
   * format, deliberately: the string must read the same in a test and on a
   * server in any timezone.
   */
  private announceInvoice(invoice: any, amountDue: number, dueDate: Date, user: User): void {
    this.notificationDispatch.dispatch({
      eventType: 'INVOICE_ISSUED',
      title: `Invoice ${invoice.invoiceNumber} issued`,
      message: `Invoice ${invoice.invoiceNumber} for job "${invoice.jobName || invoice.jobDisplayId}" has been issued. Amount due: $${Number(amountDue || 0).toFixed(2)}. Payment is due by ${new Date(
        dueDate
      )
        .toISOString()
        .slice(0, 10)}.`,
      jobId: String(invoice.jobId),
      actorSub: user.sub,
      actorDisplayName: user.preferred_username ?? user.email ?? undefined
    });
  }

  /**
   * Void an invoice: keep the document, change nothing on the charge ledger.
   *
   * There is deliberately no delete. See the comment on `Invoice.voidedAt` —
   * removing a document would recycle its invoice number, because numbering is
   * derived from `countDocuments`.
   *
   * Voiding no longer releases anything: a statement's service lines live on
   * the job's charge ledger, not on the invoice, and holding a line back is
   * voiding its charge — a separate act, on `JobChargeService`. Voiding a
   * statement only says the document itself was wrong.
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

    const voidedBy = user.email || user.preferred_username || 'unknown';
    // Conditional on still being live, so two staff voiding the same invoice at
    // once cannot overwrite each other's reason — the loser gets the refusal
    // above rather than a silent last-write-wins.
    const updated = await this.invoiceModel.findOneAndUpdate({ _id: invoiceId, voidedAt: null }, { $set: { voidedAt: new Date(), voidedBy, voidReason: trimmed } }, { new: true }).exec();
    if (!updated) {
      throw new BadRequestException(`Invoice ${(invoice as any).invoiceNumber} has already been voided.`);
    }
    return updated;
  }
}
