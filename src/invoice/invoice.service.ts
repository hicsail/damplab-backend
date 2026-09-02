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
      services: selected.map((s: any) => ({
        _id: String(s.serviceId ?? s._id),
        serviceId: String(s.serviceId ?? s._id),
        name: String(s.name ?? 'Service'),
        description: String(s.description ?? ''),
        cost: Number(s.cost) || 0,
        unitCost: s.unitCost == null ? undefined : Number(s.unitCost),
        multiplier: s.multiplier == null ? undefined : Number(s.multiplier),
        runCount: s.runCount == null ? undefined : Number(s.runCount),
        category: String(s.category ?? '')
      })),
      subtotal,
      adjustments,
      totalCost,
      billedToName: String((sow as any).clientName ?? 'Client'),
      billedToEmail: String((sow as any).clientEmail ?? ''),
      billedToAddress: (sow as any).clientAddress ?? undefined,
      customerCategory: (job as any).customerCategory ?? undefined,
      createdAt: new Date()
    });

    return invoice;
  }
}
