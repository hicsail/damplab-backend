import { Injectable, BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Invoice, InvoiceDocument } from './invoice.model';
import { InvoiceKind, invoiceVersionOf } from './invoice-kind';
import { CreateInvoiceInput } from './dto/create-invoice.input';
import { JobService } from '../job/job.service';
import { SOWService } from '../sow/sow.service';
import { SowVersionService } from '../sow/sow-version.service';
import { User } from '../auth/user.interface';
import { Role } from '../auth/roles/roles.enum';
import { SOWStatus } from '../sow/sow.model';
import { JobChargeService, chargeInputError } from '../job-payment/job-charge.service';
import { JobChargeKind } from '../job-payment/job-charge.model';
import { ContractedServiceLine, JobBalanceService, JobChargeBreakdown, applyDraft } from '../job-payment/job-balance.service';
import { NotificationDispatchService } from '../notification/notification-dispatch.service';
import { DueEntry, defaultDueSchedule, dueScheduleError, scheduleOf, scheduleTarget, sortedSchedule } from './due-schedule';

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

const COUNTERSIGNED_MESSAGE = 'Cannot generate an invoice until the Statement of Work is countersigned.';
const DEFAULT_DEPOSIT_LABEL = 'Deposit';
const BOTH_DEPOSIT_ACTIONS = 'Either change the deposit or remove it, not both.';
/** The id a preview carries: it is never saved, and must never be mistaken for a document that was. */
const PREVIEW_ID = 'preview';

/** `YYYY-MM-DD`, the same in a test and on a server in any timezone. */
function isoDay(date: Date): string {
  return new Date(date).toISOString().slice(0, 10);
}

function money(n: number): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

const cents = (n: unknown): number => Math.round((Number(n) || 0) * 100);

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

type DepositChange = 'keep' | 'set' | 'remove';
type DraftDeposit = { label: string; amount: number; dueDate: Date };

/** Everything an issue decides before it writes anything. */
interface IssuePlan {
  job: any;
  key: string;
  sow: any;
  active: any;
  customLines: Array<{ label: string; amount: number; note?: string }>;
  depositChange: DepositChange;
  deposit: DraftDeposit | null;
  liveDeposits: any[];
  /** The job as it will stand once the lines and the deposit above are written. */
  draft: JobChargeBreakdown;
  schedule: DueEntry[];
}

interface IssueOptions {
  /** Said first in the announcement — why this version was issued, when it was not staff issuing it. */
  announceLead?: string;
  /** Skip the staff-role check: the caller already passed a billing permission gate. */
  trustCaller?: boolean;
}

/** The same deposit to the cent, the day and the label — resubmitting it unchanged must not void and re-add it. */
function sameDeposit(existing: any, next: DraftDeposit): boolean {
  if (!existing?.dueDate) return false;
  return cents(existing.amount) === cents(next.amount) && String(existing.label ?? '').trim() === next.label && isoDay(existing.dueDate) === isoDay(next.dueDate);
}

/** The first date anything on the invoice falls due: the deposit while it is outstanding, and the due dates. */
function earliestDue(schedule: readonly DueEntry[], breakdown: JobChargeBreakdown): Date | undefined {
  const dates = schedule.map((e) => new Date(e.dueDate));
  if (breakdown.depositOutstanding > 0 && breakdown.depositDueDate) dates.push(new Date(breakdown.depositDueDate));
  return dates.filter((d) => !Number.isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime())[0];
}

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

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

  /** The invoice that stands on the job — the newest neither voided nor superseded — or null. */
  async findCurrent(jobId: string): Promise<Invoice | null> {
    return this.invoiceModel.findOne({ jobId, voidedAt: null, supersededAt: null }).sort({ createdAt: -1 }).exec();
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
   * What issuing with this input would state, without writing anything: the
   * issue dialog renders it as the invoice the customer will see. When the
   * input carries no due dates, the preview's are the default the dialog
   * starts from.
   */
  async previewForJob(input: CreateInvoiceInput, user: User): Promise<Invoice> {
    const plan = await this.plan(input, user, {});
    const versionNumber = await this.nextVersion(plan.key);
    return { ...this.buildDocument(plan, plan.draft, plan.schedule, versionNumber, user), _id: PREVIEW_ID } as unknown as Invoice;
  }

  /**
   * Issue a new version of the job's invoice.
   *
   * Every version restates the whole job as it stands: the countersigned SOW's
   * contracted lines and adjustments, confirmed equipment use, custom charges
   * and discounts, the deposit, the payments received, and when the balance is
   * due. Issuing one marks every earlier invoice on the job SUPERSEDED, so
   * exactly one stands.
   *
   * Besides the document, the only writes are what the caller adds or changes:
   * new custom lines, onto the job's charges where every later version picks
   * them up, and the deposit. A custom line is never taken back — a discount
   * line does that — but the deposit can be changed or removed here, since
   * there is nowhere else to do it.
   */
  async createForJob(input: CreateInvoiceInput, user: User, options: IssueOptions = {}): Promise<Invoice> {
    const plan = await this.plan(input, user, options);
    const { key } = plan;

    if (plan.depositChange !== 'keep') {
      const reason = plan.depositChange === 'remove' ? 'Removed while issuing a new invoice version.' : 'Replaced while issuing a new invoice version.';
      for (const charge of plan.liveDeposits) await this.charges.voidCharge(String(charge._id), reason, user);
    }
    for (const line of plan.customLines) {
      await this.charges.addCharge({ jobId: key, kind: JobChargeKind.CUSTOM, label: line.label, amount: line.amount, note: line.note }, user);
    }
    if (plan.depositChange === 'set' && plan.deposit) {
      await this.charges.addCharge({ jobId: key, kind: JobChargeKind.DEPOSIT, ...plan.deposit }, user);
    }

    // Read after the writes: the invoice states the job as it stands now. A
    // booking confirmed or a payment recorded since the plan moves the balance;
    // the due dates are then restated against it rather than left disagreeing.
    const breakdown = await this.balances.chargeBreakdown(key);
    const target = scheduleTarget(breakdown.balanceDue, breakdown.depositOutstanding);
    const schedule = dueScheduleError(plan.schedule, target) ? defaultDueSchedule(plan.schedule, target, new Date()) : plan.schedule;

    const versionNumber = await this.nextVersion(key);
    const invoice = await this.invoiceModel.create(this.buildDocument(plan, breakdown, schedule, versionNumber, user));

    // After the create, so a refused create supersedes nothing.
    await this.invoiceModel
      .updateMany({ jobId: key, _id: { $ne: (invoice as any)._id }, voidedAt: null, supersededAt: null }, { $set: { supersededAt: new Date(), supersededByNumber: (invoice as any).invoiceNumber } })
      .exec();

    this.announceInvoice(invoice, breakdown, schedule, user, options.announceLead);
    return invoice;
  }

  /**
   * Restate the job's invoice after a payment was recorded or voided, so the
   * customer is never looking at a balance the lab knows is wrong.
   *
   * Only when an invoice stands: a payment on a job the lab has not invoiced
   * yet, or whose invoice was voided, must not issue one on its own. And never
   * at the payment's expense — the payment is already written, so a refusal
   * here (the SOW no longer countersigned, say) is logged, not thrown.
   *
   * Returns the new version, or null when none was issued.
   */
  async reissueAfterPaymentChange(jobId: string, user: User, lead: string): Promise<Invoice | null> {
    const current = await this.findCurrent(jobId);
    if (!current) return null;
    try {
      return await this.createForJob({ jobId } as CreateInvoiceInput, user, { announceLead: lead, trustCaller: true });
    } catch (err: any) {
      this.logger.warn(`Could not reissue the invoice for job ${jobId} after a payment change: ${err?.message ?? err}`);
      return null;
    }
  }

  // Counts EVERY document on the job — voided and superseded ones included —
  // so a number is never reused and the version only ever climbs. The unique
  // (jobId, invoiceNumber) index refuses the loser of two concurrent issues.
  private async nextVersion(key: string): Promise<number> {
    return (await this.invoiceModel.countDocuments({ jobId: key }).exec()) + 1;
  }

  /**
   * Every refusal an issue can make, decided before a single charge is written:
   * there is no rollback through JobChargeService, so a bad third line — or due
   * dates that do not add up — must not leave the first two lines on the job.
   */
  private async plan(input: CreateInvoiceInput, user: User, options: IssueOptions): Promise<IssuePlan> {
    if (!options.trustCaller) {
      const roles = user.realm_access?.roles ?? [];
      if (!roles.includes(Role.DamplabStaff)) {
        throw new ForbiddenException('Only staff can generate invoices');
      }
    }

    const job: any = await this.jobService.findById(input.jobId);
    if (!job) {
      throw new NotFoundException(`Job with ID ${input.jobId} not found`);
    }
    const key = String(job._id);

    // An invoice bills a countersigned document, or nothing — one message for
    // every way that can fail (never sent, cancelled, withdrawn): the action that
    // clears all of them is the same, countersign the SOW.
    const sow: any = await this.sowService.findByJobId(key);
    const active = sow ? await this.sowVersionService.getActiveVersion(String(sow._id)) : null;
    if (!sow || active?.status !== SOWStatus.FINAL) throw new BadRequestException(COUNTERSIGNED_MESSAGE);

    const customLines = (input.customLines ?? []).map((line) => {
      const note = String(line.note ?? '').trim();
      return { label: String(line.label ?? '').trim(), amount: Number(line.amount), ...(note ? { note } : {}) };
    });
    for (const line of customLines) {
      const refusal = chargeInputError({ kind: JobChargeKind.CUSTOM, label: line.label, amount: line.amount });
      if (refusal) throw new BadRequestException(refusal);
    }

    if (input.deposit && input.removeDeposit) throw new BadRequestException(BOTH_DEPOSIT_ACTIONS);
    let deposit: DraftDeposit | null = null;
    if (input.deposit) {
      const label = String(input.deposit.label ?? '').trim() || DEFAULT_DEPOSIT_LABEL;
      const refusal = chargeInputError({ kind: JobChargeKind.DEPOSIT, label, amount: input.deposit.amount, dueDate: input.deposit.dueDate });
      if (refusal) throw new BadRequestException(refusal);
      deposit = { label, amount: Number(input.deposit.amount), dueDate: new Date(input.deposit.dueDate) };
    }

    const byAdded = (a: any, b: any): number => new Date(a.addedAt ?? 0).getTime() - new Date(b.addedAt ?? 0).getTime();
    const liveDeposits = (await this.charges.liveByJobId(key)).filter((c: any) => String(c.kind) === JobChargeKind.DEPOSIT).sort(byAdded);
    const currentDeposit = liveDeposits[liveDeposits.length - 1] ?? null;
    const depositChange: DepositChange = input.removeDeposit ? (currentDeposit ? 'remove' : 'keep') : deposit && !sameDeposit(currentDeposit, deposit) ? 'set' : 'keep';

    const draft = applyDraft(await this.balances.chargeBreakdown(key), {
      customLines,
      deposit: depositChange === 'set' ? deposit : undefined,
      removeDeposit: depositChange === 'remove'
    });
    const target = scheduleTarget(draft.balanceDue, draft.depositOutstanding);

    let schedule: DueEntry[];
    if (input.dueSchedule) {
      const entries = input.dueSchedule.map((e) => ({ amount: Math.round(Number(e.amount) * 100) / 100, dueDate: new Date(e.dueDate) }));
      const refusal = dueScheduleError(entries, target);
      if (refusal) throw new BadRequestException(refusal);
      schedule = sortedSchedule(entries);
    } else {
      // What payments since the standing version settled of its due dates: the
      // rise in payments, less the part that went to its deposit instead.
      const previous: any = await this.findCurrent(key);
      const depositShare = Math.max(0, (Number(previous?.deposit?.outstanding) || 0) - draft.depositOutstanding);
      const paidSince = previous ? Math.max(0, draft.paymentsToDate - (Number(previous.paymentsToDate) || 0) - depositShare) : 0;
      schedule = defaultDueSchedule(scheduleOf(previous), target, new Date(), paidSince);
    }

    return { job, key, sow, active, customLines, depositChange, deposit, liveDeposits, draft, schedule };
  }

  /** The document a version writes — or, for a preview, would write. */
  private buildDocument(plan: IssuePlan, breakdown: JobChargeBreakdown, schedule: readonly DueEntry[], versionNumber: number, user: User): any {
    const { job, key, sow, active } = plan;
    const jobDisplayId = String(job.jobId ?? job._id);
    const invoiceDate = new Date();
    return {
      job: job._id,
      jobId: key,
      jobDisplayId,
      jobName: job.name ?? '',
      invoiceNumber: `${jobDisplayId}-${pad3(versionNumber)}`,
      versionNumber,
      kind: InvoiceKind.STATEMENT,
      invoiceDate,
      createdBy: user.email || user.preferred_username || 'unknown',
      services: breakdown.serviceLines.map(toInvoiceServiceLine),
      adjustments: breakdown.adjustments,
      equipmentLines: this.toEquipmentLines(breakdown.bookings),
      customLines: breakdown.customLines.map((c: any) => ({ chargeId: String(c._id), kind: c.kind, label: c.label, amount: c.amount, note: c.note ?? undefined })),
      deposit: this.toDeposit(breakdown),
      payments: breakdown.payments.map((p: any) => ({
        paymentId: String(p._id),
        amount: Number(p.amount) || 0,
        receivedOn: p.receivedOn,
        reference: p.reference ? String(p.reference) : undefined
      })),
      subtotal: breakdown.chargesToDate,
      paymentsToDate: breakdown.paymentsToDate,
      balanceDue: breakdown.balanceDue,
      // What is payable NOW, which is the balance and not the charges — the
      // customer must not be asked twice for what they have already paid.
      totalCost: breakdown.balanceDue,
      dueSchedule: schedule.map((e) => ({ amount: e.amount, dueDate: e.dueDate })),
      dueDate: earliestDue(schedule, breakdown),
      billedToName: String(sow?.clientName ?? 'Client'),
      billedToEmail: String(sow?.clientEmail ?? ''),
      billedToAddress: sow?.clientAddress ?? undefined,
      customerCategory: active?.inputs?.customerCategory ?? job.customerCategory ?? undefined,
      sowVersionNumber: breakdown.sowVersionNumber ?? active?.versionNumber,
      createdAt: invoiceDate
    };
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
   * Tell the job owner a new version exists, what it asks for, and by when.
   * Fire-and-forget — NotificationDispatchService never throws.
   */
  private announceInvoice(invoice: any, breakdown: JobChargeBreakdown, schedule: readonly DueEntry[], user: User, lead?: string): void {
    const label = `Invoice ${invoice.jobDisplayId} · v${invoice.versionNumber}`;
    const balance = Number(breakdown.balanceDue || 0);
    const dates: string[] = [];
    if (breakdown.depositOutstanding > 0 && breakdown.depositDueDate) dates.push(`${money(breakdown.depositOutstanding)} (deposit) by ${isoDay(breakdown.depositDueDate)}`);
    for (const entry of schedule) dates.push(`${money(entry.amount)} by ${isoDay(entry.dueDate)}`);
    const due = balance > 0 ? `Balance due: ${money(balance)}${dates.length > 0 ? ` — ${dates.join('; ')}` : ''}.` : 'Nothing is due: the payments received cover it.';
    this.notificationDispatch.dispatch({
      eventType: 'INVOICE_ISSUED',
      title: `${label} issued`,
      message: `${lead ? `${lead} ` : ''}${label} for job "${invoice.jobName || invoice.jobDisplayId}" has been issued. ${due}`,
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

    // The customer hears about every change to their invoice, a void included.
    const version = invoiceVersionOf(updated as any);
    const label = version != null && (updated as any).jobDisplayId ? `Invoice ${(updated as any).jobDisplayId} · v${version}` : `Invoice ${(updated as any).invoiceNumber}`;
    this.notificationDispatch.dispatch({
      eventType: 'INVOICE_VOIDED',
      title: `${label} voided`,
      message: `${label} for job "${(updated as any).jobName || (updated as any).jobDisplayId}" has been voided and is no longer payable. Reason: ${trimmed}`,
      jobId: String((updated as any).jobId),
      actorSub: user.sub,
      actorDisplayName: user.preferred_username ?? user.email ?? undefined
    });
    return updated;
  }
}
