import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Invoice, InvoiceDocument } from './invoice.model';
import { CreateInvoiceInput } from './dto/create-invoice.input';
import { JobService } from '../job/job.service';
import { SOWService } from '../sow/sow.service';
import { SowVersionService } from '../sow/sow-version.service';
import { User } from '../auth/user.interface';
import { Role } from '../auth/roles/roles.enum';
import { selectServiceLines } from './select-service-lines';

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
    private readonly sowVersionService: SowVersionService
  ) {}

  async findByJobId(jobId: string): Promise<Invoice[]> {
    return this.invoiceModel.find({ jobId }).sort({ createdAt: -1 }).exec();
  }

  /** How many invoices a job has. The jobs list asks this per row, so it never loads the documents. */
  async countByJobId(jobId: string): Promise<number> {
    return this.invoiceModel.countDocuments({ jobId }).exec();
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
    const priorInvoices = await this.invoiceModel.find({ jobId: input.jobId }).exec();
    const billingWarnings: string[] = [];
    const billedIndexes = new Map<number, string>();

    for (const prior of priorInvoices) {
      const priorNumber = String((prior as any).invoiceNumber ?? prior._id);
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
      throw new BadRequestException(`These services have already been invoiced for this job: ${described}. Deselect them, or void the earlier invoice first.`);
    }

    const subtotal = round2(selected.reduce((sum, s) => sum + (Number(s.cost) || 0), 0));

    // Carry the SOW's pricing adjustments onto the invoice.
    //
    // Adjustments are fixed dollar amounts against the WHOLE job, but this
    // invoice may cover only some of its services, and a job can legitimately be
    // billed across several invoices. Applying the full amount to each would
    // credit a discount more than once, so prorate by this invoice's share of the
    // SOW base cost. Every invoice for a job then sums to the SOW total,
    // independent of how the services were split up or the order of generation.
    //
    // Base cost is recomputed from the SOW's own line items rather than trusting
    // the stored pricing.baseCost, so the ratio can't be skewed by a stale value.
    const sowBaseCost = round2(sowServices.reduce((sum: number, s: any) => sum + (Number(s.cost) || 0), 0));
    const prorationFactor = sowBaseCost > 0 ? Math.min(1, subtotal / sowBaseCost) : 0;

    // Same rule as the service lines: the adjustments that were in force with
    // the customer, not whatever the document holds today.
    const rawAdjustments: any[] = active?.inputs?.adjustments ?? (Array.isArray((sow as any).pricing?.adjustments) ? (sow as any).pricing.adjustments : []);
    const adjustments = rawAdjustments.map((adj: any) => {
      const type = String(adj?.type ?? '');
      const amount = Number(adj?.amount) || 0;
      // Sign matches SOWService.calculateAdjustmentsTotal: DISCOUNT subtracts,
      // ADDITIONAL_COST adds, SPECIAL_TERM is a note with no monetary effect.
      const signed = type === 'DISCOUNT' ? -amount : type === 'ADDITIONAL_COST' ? amount : 0;
      return {
        type,
        description: String(adj?.description ?? ''),
        reason: adj?.reason ? String(adj.reason) : undefined,
        amount,
        appliedAmount: round2(signed * prorationFactor),
        // 4dp, not 2: rounding the factor to cents would show two different
        // partials as an identical "0.5", and a genuine 0.997 would round to 1
        // and read as a full-job invoice.
        prorationFactor: Math.round(prorationFactor * 10000) / 10000
      };
    });

    const adjustmentsTotal = round2(adjustments.reduce((sum: number, a: any) => sum + a.appliedAmount, 0));
    // Never invoice a negative amount — an over-large discount floors at zero.
    const totalCost = round2(Math.max(0, subtotal + adjustmentsTotal));

    // Generate next invoice number per job: "<jobDisplayId>-<seq>"
    const existingCount = await this.invoiceModel.countDocuments({ jobId: input.jobId }).exec();
    const seq = existingCount + 1;
    const jobDisplayId = String((job as any).jobId ?? job._id);
    const invoiceNumber = `${jobDisplayId}-${pad3(seq)}`;

    const createdBy = user.email || user.preferred_username || 'unknown';

    const invoice = await this.invoiceModel.create({
      job: (job as any)._id,
      jobId: String((job as any)._id),
      jobDisplayId,
      jobName: (job as any).name ?? '',
      invoiceNumber,
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
      customerCategory: (job as any).customerCategory ?? undefined,
      sowVersionNumber: sowVersionNumber ?? undefined,
      billingWarnings: billingWarnings.length > 0 ? billingWarnings : undefined,
      createdAt: new Date()
    });

    return invoice;
  }
}
