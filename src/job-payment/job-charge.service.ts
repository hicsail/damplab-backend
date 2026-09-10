import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JobCharge, JobChargeDocument, JobChargeKind } from './job-charge.model';
import { AddJobChargeInput } from './dto/add-job-charge.input';
import { JobService } from '../job/job.service';
import { User } from '../auth/user.interface';

/** Money rounding, matching JobPaymentService — a balance must not carry float noise. */
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Charge refusal messages shared with InvoiceService, so staff see the same
 * wording whether the refusal came from adding a charge directly or from
 * issuing an invoice.
 */
export const CHARGE_MESSAGES = {
  labelRequired: 'A label is required for a charge.',
  amountZero: 'A charge amount cannot be zero.',
  depositNotPositive: 'A deposit must be greater than zero.',
  depositDueDateRequired: 'A deposit needs a due date.',
  depositExists: 'This job already has a deposit. Void it before setting a new one.',
  reasonRequired: 'A reason is required to void a charge.',
  alreadyVoided: 'That charge has already been voided.'
} as const;

/**
 * Why a charge input would be refused, or null when it is fine — everything
 * that can be decided without reading the database.
 *
 * Exported so InvoiceService can check every line an invoice adds before it
 * writes the first one: charges have no rollback, so a bad third line must not
 * leave the first two on the job.
 */
export function chargeInputError(input: { kind: JobChargeKind | string; label?: string | null; amount?: number | null; dueDate?: Date | string | null }): string | null {
  if (!String(input.label ?? '').trim()) return CHARGE_MESSAGES.labelRequired;
  const amount = round2(input.amount as number);
  if (input.kind === JobChargeKind.DEPOSIT) {
    if (!(amount > 0)) return CHARGE_MESSAGES.depositNotPositive;
    const due = input.dueDate ? new Date(input.dueDate) : null;
    if (!due || Number.isNaN(due.getTime())) return CHARGE_MESSAGES.depositDueDateRequired;
  } else if (input.kind === JobChargeKind.CUSTOM) {
    if (amount === 0) return CHARGE_MESSAGES.amountZero;
  }
  return null;
}

@Injectable()
export class JobChargeService {
  constructor(@InjectModel(JobCharge.name) private readonly model: Model<JobChargeDocument>, @Inject(forwardRef(() => JobService)) private readonly jobService: JobService) {}

  /**
   * Every charge ever added to the job, voided ones included — the job page
   * shows those struck through with their reason, because a total that moved
   * has to be explicable. Newest added first, matching the model's index on
   * { jobId: 1, addedAt: -1 }.
   */
  async findByJobId(jobId: string): Promise<JobCharge[]> {
    return this.model.find({ jobId }).sort({ addedAt: -1 }).exec();
  }

  /** Live charges only — what the balance is computed from. */
  async liveByJobId(jobId: string): Promise<JobCharge[]> {
    return this.model.find({ jobId, voidedAt: null }).exec();
  }

  async addCharge(input: AddJobChargeInput, user: User): Promise<JobCharge> {
    const refusal = chargeInputError(input);
    if (refusal) {
      throw new BadRequestException(refusal);
    }

    // SERVICE_LINE belongs to the retired release-by-line invoicing. Services
    // come from the countersigned Statement of Work now, never from a charge.
    if (String(input.kind) === JobChargeKind.SERVICE_LINE) {
      throw new BadRequestException('Service lines come from the Statement of Work, not from charges.');
    }

    const job: any = await this.jobService.findById(String(input.jobId));
    if (!job) {
      throw new NotFoundException(`Job with ID ${input.jobId} not found`);
    }

    // One deposit per job: the invoice asks for "the deposit" by its own due
    // date, and two would leave it unclear which date governs. Changing it is
    // voiding the old one first, which keeps the reason on the record.
    if (input.kind === JobChargeKind.DEPOSIT) {
      const live = await this.liveByJobId(String(job._id));
      if (live.some((c: any) => String(c.kind) === JobChargeKind.DEPOSIT)) {
        throw new BadRequestException(CHARGE_MESSAGES.depositExists);
      }
    }

    const note = String(input.note ?? '').trim();
    return this.model.create({
      // String(job._id), not the argument: the same key Booking.jobId and
      // SOW.jobId use, so the balance query joins on one value.
      jobId: String(job._id),
      kind: input.kind,
      label: String(input.label).trim(),
      amount: round2(input.amount),
      addedBy: user.email || user.preferred_username || 'unknown',
      addedAt: new Date(),
      ...(input.kind === JobChargeKind.DEPOSIT ? { dueDate: new Date(input.dueDate as Date) } : {}),
      ...(note ? { note } : {})
    });
  }

  /**
   * Void, never delete: the ledger is the explanation for every move in the
   * total. Mirrors JobPaymentService.voidPayment exactly, including the
   * findOneAndUpdate({ _id, voidedAt: null }) conditional so two staff voiding
   * at once cannot overwrite each other's reason.
   */
  async voidCharge(id: string, reason: string, user: User): Promise<JobCharge> {
    const trimmed = String(reason ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException(CHARGE_MESSAGES.reasonRequired);
    }

    const charge: any = await this.model.findById(id).exec();
    if (!charge) {
      throw new NotFoundException(`Charge with ID ${id} not found`);
    }
    if (charge.voidedAt) {
      throw new BadRequestException(CHARGE_MESSAGES.alreadyVoided);
    }

    const voidedBy = user.email || user.preferred_username || 'unknown';
    // Conditional on still being live, so two staff voiding at once cannot
    // overwrite each other's reason.
    const updated = await this.model.findOneAndUpdate({ _id: id, voidedAt: null }, { $set: { voidedAt: new Date(), voidedBy, voidReason: trimmed } }, { new: true }).exec();
    if (!updated) {
      throw new BadRequestException(CHARGE_MESSAGES.alreadyVoided);
    }
    return updated;
  }
}
