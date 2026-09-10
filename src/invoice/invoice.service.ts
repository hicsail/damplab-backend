import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Invoice, InvoiceDocument } from './invoice.model';
import { InvoiceKind, invoiceKindOf } from './invoice-kind';
import { CreateInvoiceInput } from './dto/create-invoice.input';
import { JobService } from '../job/job.service';
import { SOWService } from '../sow/sow.service';
import { SowVersionService } from '../sow/sow-version.service';
import { User } from '../auth/user.interface';
import { Role } from '../auth/roles/roles.enum';
import { selectServiceLines } from './select-service-lines';
import { invoiceBlockedReason } from '../sow/sow-access';
import { SOWStatus } from '../sow/sow.model';
import { JobBalanceService } from '../job-payment/job-balance.service';
import { NotificationDispatchService } from '../notification/notification-dispatch.service';
import { appliedAdjustmentsTotal, prorateAdjustments, prorationFactorFor } from '../sow/prorate-adjustments';

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

/** Money rounding — keeps prorated adjustments from carrying float noise onto an invoice. */
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

@Injectable()
export class InvoiceService {
  constructor(
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<InvoiceDocument>,
    private readonly jobService: JobService,
    private readonly sowService: SOWService,
    private readonly sowVersionService: SowVersionService,
    private readonly balances: JobBalanceService,
    private readonly notificationDispatch: NotificationDispatchService
  ) {}

  async findByJobId(jobId: string): Promise<Invoice[]> {
    return this.invoiceModel.find({ jobId }).sort({ createdAt: -1 }).exec();
  }

  /**
   * How many invoices **stand** against a job. The jobs list asks this per row, so
   * it never loads the documents.
   *
   * Voided invoices are excluded, because the only question this answers is
   * "has this job been billed yet" — and a job whose one invoice was voided has
   * not.
   *
   * **Two other counts deliberately differ, and the split is easy to misread:**
   *
   *  - the numbering count inside `createForJob` counts *everything*, because a
   *    void releases an invoice's lines but never its number;
   *  - the job detail pane (`TechnicianView` / `ClientView`) counts *records*, so
   *    a job with one voided invoice reads "Invoices · None" in the jobs list and
   *    "1 invoice, voided" on the detail page. That is intentional: the list
   *    answers "billed?", the pane lists what exists — and the pane says "voided"
   *    on the same line so the two cannot be read as contradicting each other.
   */
  async countByJobId(jobId: string): Promise<number> {
    return this.invoiceModel.countDocuments({ jobId, voidedAt: null }).exec();
  }

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

    const sow = await this.sowService.findByJobId(input.jobId);
    if (!sow) {
      throw new BadRequestException('Cannot generate invoice: job has no SOW');
    }

    // An invoice bills a countersigned document, or nothing. Without this a DRAFT,
    // never-sent SOW invoiced happily — and with no version in force
    // `billableServiceLines` falls back to the *live* billing core, which the
    // workflow sync rewrites, so the figure billed was one no document ever stated.
    //
    // The history is fetched rather than inferred from the pointer: withdrawing a
    // SOW zeroes `activeVersionNumber` exactly as never having issued one leaves
    // it, and staff who countersigned a SOW last week need to be told it was
    // withdrawn, not that they never countersigned it.
    const sowIdForGate = String((sow as any)._id);
    const activeForGate = await this.sowVersionService.getActiveVersion(sowIdForGate);
    if (activeForGate?.status !== SOWStatus.FINAL) {
      const history = await this.sowVersionService.listVersions(sowIdForGate);
      const blocked = invoiceBlockedReason(activeForGate?.status, {
        hasAnyVersion: history.length > 0,
        everCountersigned: history.some((version) => version.status === SOWStatus.FINAL)
      });
      if (blocked) throw new BadRequestException(blocked);
    }

    // What this invoice bills, and what the staff dialog listed — one array, so
    // a position means the same thing on both sides. See billableServiceLines.
    const sowServices: any[] = await this.sowService.billableServiceLines(sow);
    // Adjustments follow the same "version in force, else the billing core"
    // rule, but keep their own fallback: deriveInputs drops SPECIAL_TERM, and
    // those are carried onto the invoice as zero-amount notes.
    const active = await this.sowVersionService.getActiveVersion(String((sow as any)._id));

    // Refuses anything it cannot place exactly, rather than dropping it. Every
    // unresolvable selection here was previously a silent mis-bill.
    const selected = selectServiceLines(sowServices, {
      services: input.services,
      serviceIds: Array.isArray(input.serviceIds) ? input.serviceIds.map(String).filter(Boolean) : []
    });

    // Which lines these are, by position in the billing source — the same thing
    // the staff dialog ticked. Recomputed by identity here rather than read off
    // `input`, because the legacy serviceIds branch carries no positions of its
    // own; the used-set keeps two picks of the same line from resolving to one
    // position. -1 cannot happen (selectServiceLines returns members of this very
    // array) but is carried honestly rather than asserted away.
    const claimedIndexes = new Set<number>();
    const selectedIndexes = selected.map((line) => {
      const found = sowServices.findIndex((candidate, index) => candidate === line && !claimedIndexes.has(index));
      if (found >= 0) claimedIndexes.add(found);
      return found;
    });
    const sowVersionNumber = active?.versionNumber ?? null;

    // Nothing used to stop a job being invoiced twice for the same line. The
    // duplicate guard inside selectServiceLines is per-call, so two invoices
    // could each bill position 0: the work was charged twice, and because
    // adjustments are prorated per invoice, the discount was credited twice as
    // well. The comment below about every invoice summing to the SOW total holds
    // only if the invoices partition the lines, which is what this enforces.
    //
    // Voided invoices are excluded here, and that exclusion is what makes voiding
    // mean anything: a void releases its lines back for re-invoicing. `voidedAt:
    // null` matches both an absent field and an explicit null, so live invoices
    // written before voiding existed still count.
    const priorInvoices = await this.invoiceModel.find({ jobId: input.jobId, voidedAt: null }).exec();
    const billingWarnings: string[] = [];
    const billedIndexes = new Map<number, string>();

    for (const prior of priorInvoices) {
      const priorNumber = String((prior as any).invoiceNumber ?? prior._id);
      // An equipment invoice bills confirmed bookings, never SOW service lines, so
      // it can neither claim a position nor leave one unproven. Skipped BEFORE the
      // checks below rather than after: its `services` is empty, which passes the
      // positions test vacuously but then trips the version test and emits a
      // billing warning about an invoice that has nothing to do with these lines.
      if (invoiceKindOf(prior as any) === InvoiceKind.EQUIPMENT) continue;
      const priorLines: any[] = Array.isArray((prior as any).services) ? (prior as any).services : [];
      const priorVersion = (prior as any).sowVersionNumber ?? null;
      const positioned = priorLines.filter((line) => typeof line?.sourceIndex === 'number');

      if (positioned.length !== priorLines.length) {
        // Written before positions were recorded: its lines cannot be compared
        // with these, and pretending otherwise would be the same silent
        // assumption this check exists to remove.
        billingWarnings.push(`Invoice ${priorNumber} predates line tracking, so its services could not be checked against this one.`);
        continue;
      }
      if (priorVersion === null || sowVersionNumber === null) {
        // One of the two was billed off the live billing core rather than an
        // issued version — which is what happens when no version is in force
        // (see billableServiceLines). The core is rewritten by every workflow
        // sync, so a position in it does not keep its meaning between invoices.
        billingWarnings.push(`Invoice ${priorNumber} was billed from the Statement of Work's live figures rather than an issued version, so its services could not be checked against this one.`);
        continue;
      }
      if (priorVersion !== sowVersionNumber) {
        // Positions are only comparable within one version — a re-synced SOW can
        // reorder its lines.
        billingWarnings.push(`Invoice ${priorNumber} was billed from a different version of this Statement of Work, so its services could not be checked against this one.`);
        continue;
      }
      for (const line of positioned) billedIndexes.set(Number(line.sourceIndex), priorNumber);
    }

    const alreadyBilled = selectedIndexes.map((index, position) => ({ index, position })).filter(({ index }) => index >= 0 && billedIndexes.has(index));

    if (alreadyBilled.length > 0) {
      const described = alreadyBilled.map(({ index, position }) => `"${String((selected[position] as any)?.name ?? 'Service')}" (already on invoice ${billedIndexes.get(index)})`).join(', ');
      throw new BadRequestException(`These services have already been invoiced for this job: ${described}. Deselect them, or void that invoice to release its lines.`);
    }

    const subtotal = round2(selected.reduce((sum, s) => sum + (Number(s.cost) || 0), 0));

    // Carry the SOW's pricing adjustments onto the invoice. Base cost is
    // recomputed from the SOW's own line items rather than trusting the stored
    // pricing.baseCost, so the ratio can't be skewed by a stale value. See
    // prorationFactorFor for why the proration happens at all.
    const sowBaseCost = round2(sowServices.reduce((sum: number, s: any) => sum + (Number(s.cost) || 0), 0));
    const prorationFactor = prorationFactorFor(subtotal, sowBaseCost);

    // Same rule as the service lines: the adjustments that were in force with
    // the customer, not whatever the document holds today.
    const rawAdjustments: any[] = active?.inputs?.adjustments ?? (Array.isArray((sow as any).pricing?.adjustments) ? (sow as any).pricing.adjustments : []);
    const adjustments = prorateAdjustments(rawAdjustments, prorationFactor);

    const adjustmentsTotal = appliedAdjustmentsTotal(adjustments);
    // Never invoice a negative amount — an over-large discount floors at zero.
    const totalCost = round2(Math.max(0, subtotal + adjustmentsTotal));

    const jobDisplayId = String((job as any).jobId ?? job._id);
    const invoiceNumber = await this.nextInvoiceNumber(String((job as any)._id), jobDisplayId);

    const createdBy = user.email || user.preferred_username || 'unknown';

    const invoice = await this.invoiceModel.create({
      job: (job as any)._id,
      jobId: String((job as any)._id),
      jobDisplayId,
      jobName: (job as any).name ?? '',
      invoiceNumber,
      kind: InvoiceKind.SOW,
      invoiceDate: new Date(),
      createdBy,
      // Carry the pricing breakdown, not just the total. The SOW's Fee Schedule
      // renders "$unitCost x multiplier = $cost" off these same three fields;
      // dropping them here is what left the invoice's pricing column blank.
      // Undefined is preserved rather than coerced to 0 — a legacy line has no
      // breakdown, and 0 would read as a free unit rather than as "unknown".
      services: selected.map((s: any, position: number) => ({
        _id: String(s.serviceId ?? s._id),
        serviceId: String(s.serviceId ?? s._id),
        name: String(s.name ?? 'Service'),
        description: String(s.description ?? ''),
        cost: Number(s.cost) || 0,
        unitCost: s.unitCost == null ? undefined : Number(s.unitCost),
        multiplier: s.multiplier == null ? undefined : Number(s.multiplier),
        runCount: s.runCount == null ? undefined : Number(s.runCount),
        // What the SOW's Fee Schedule itemises for a parameter-priced line.
        // Without it the invoice printed the total and nothing else, so a
        // customer could not see which selections they were being billed for.
        pricingDetails: Array.isArray(s.pricingDetails) && s.pricingDetails.length > 0 ? s.pricingDetails : undefined,
        category: String(s.category ?? ''),
        sourceIndex: selectedIndexes[position] >= 0 ? selectedIndexes[position] : undefined
      })),
      subtotal,
      adjustments,
      totalCost,
      billedToName: String((sow as any).clientName ?? 'Client'),
      billedToEmail: String((sow as any).clientEmail ?? ''),
      billedToAddress: (sow as any).clientAddress ?? undefined,
      // The category the lines were BILLED under, not the one the job carries
      // today. Every figure on this invoice comes from the frozen version, and
      // `deriveInputs` stores the category alongside them — `jobBillingFingerprint`
      // already treats it as part of the billing identity. Stamping the live job's
      // category instead made a re-categorised job reprint an old invoice with the
      // wrong header and the wrong payment instructions.
      //
      // The job is the fallback rather than an error because a version-less SOW
      // legitimately has no frozen category to read; falling back is only
      // misleading once a version exists.
      customerCategory: active?.inputs?.customerCategory ?? (job as any).customerCategory ?? undefined,
      sowVersionNumber: sowVersionNumber ?? undefined,
      billingWarnings: billingWarnings.length > 0 ? billingWarnings : undefined,
      createdAt: new Date()
    });

    this.announceInvoice(invoice, totalCost, user);
    return invoice;
  }

  /**
   * The next number in the job's `<jobDisplayId>-NNN` series.
   *
   * Counts EVERY invoice on the job, voided ones and both kinds included: a
   * void releases an invoice's lines but never its number, and the two kinds
   * deliberately share one series so a customer sees one sequence of documents.
   */
  private async nextInvoiceNumber(jobId: string, jobDisplayId: string): Promise<string> {
    const existingCount = await this.invoiceModel.countDocuments({ jobId }).exec();
    return `${jobDisplayId}-${pad3(existingCount + 1)}`;
  }

  /**
   * Tell the job owner an invoice exists and what it asks for. Both kinds, one
   * event: the customer's question is "what do I owe", not "which generator ran".
   * Fire-and-forget — NotificationDispatchService never throws.
   */
  private announceInvoice(invoice: any, amountDue: number, user: User): void {
    this.notificationDispatch.dispatch({
      eventType: 'INVOICE_ISSUED',
      title: `Invoice ${invoice.invoiceNumber} issued`,
      message: `Invoice ${invoice.invoiceNumber} for job "${invoice.jobName || invoice.jobDisplayId}" has been issued. Amount due: $${Number(amountDue || 0).toFixed(2)}.`,
      jobId: String(invoice.jobId),
      actorSub: user.sub,
      actorDisplayName: user.preferred_username ?? user.email ?? undefined
    });
  }

  /**
   * A running statement of the job's equipment use.
   *
   * Not incremental: every equipment invoice lists every confirmed booking on
   * the job to date and states charges, payments and the balance. Two
   * consecutive invoices may list the same hours — what changes is the balance,
   * which is the figure the customer acts on. That is why there is no
   * "already billed" guard here and why voiding one releases nothing: an
   * equipment invoice claims no lines.
   */
  async createEquipmentInvoice(jobId: string, user: User): Promise<Invoice> {
    const job: any = await this.jobService.findById(jobId);
    if (!job) {
      throw new NotFoundException(`Job with ID ${jobId} not found`);
    }

    // One message for "no SOW" and "not countersigned": from the lab's point of
    // view they are the same fact, and the action that clears both is the same.
    const countersigned = 'Cannot generate an equipment invoice until the Statement of Work is countersigned.';
    const sow: any = await this.sowService.findByJobId(jobId);
    if (!sow) throw new BadRequestException(countersigned);
    const active = await this.sowVersionService.getActiveVersion(String(sow._id));
    if (active?.status !== SOWStatus.FINAL) throw new BadRequestException(countersigned);

    const key = String(job._id);
    const balance = await this.balances.balance(key);
    if (!(balance.chargesToDate > 0 || balance.paymentsToDate > 0)) {
      // Hours confirmed against an operation whose service has no price sum to
      // nothing — say that, not "no usage", or the lab looks for a booking to
      // confirm that is already confirmed.
      if (balance.confirmedHours > 0) {
        throw new BadRequestException("Confirmed usage on this job has no rate. Set a price for the operation's service and confirm the usage again.");
      }
      throw new BadRequestException('Nothing to invoice yet: no confirmed equipment usage on this job.');
    }

    // Lines and money come from the same service, so a statement can never list
    // one set of bookings and total another.
    const bookings = await this.balances.confirmedBookings(key);
    const equipmentLines = bookings.map((booking: any) => ({
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

    const jobDisplayId = String(job.jobId ?? job._id);
    const invoiceNumber = await this.nextInvoiceNumber(key, jobDisplayId);

    const invoice = await this.invoiceModel.create({
      job: job._id,
      jobId: key,
      jobDisplayId,
      jobName: job.name ?? '',
      invoiceNumber,
      kind: InvoiceKind.EQUIPMENT,
      invoiceDate: new Date(),
      createdBy: user.email || user.preferred_username || 'unknown',
      services: [],
      adjustments: [],
      equipmentLines,
      subtotal: balance.chargesToDate,
      paymentsToDate: balance.paymentsToDate,
      balanceDue: balance.balanceDue,
      // What is payable NOW, which for a running statement is the balance and
      // not the charges — the customer must not be asked twice for what they
      // have already paid.
      totalCost: balance.balanceDue,
      billedToName: String(sow.clientName ?? 'Client'),
      billedToEmail: String(sow.clientEmail ?? ''),
      billedToAddress: sow.clientAddress ?? undefined,
      customerCategory: active?.inputs?.customerCategory ?? job.customerCategory ?? undefined,
      sowVersionNumber: active?.versionNumber ?? undefined,
      createdAt: new Date()
    });

    this.announceInvoice(invoice, balance.balanceDue, user);
    return invoice;
  }

  /**
   * Void an invoice: keep the document, release its lines.
   *
   * There is deliberately no delete. See the comment on `Invoice.voidedAt` —
   * removing a document would recycle its invoice number, because numbering is
   * derived from `countDocuments`.
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
