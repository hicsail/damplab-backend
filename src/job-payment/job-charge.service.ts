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
 * Charge refusal messages shared with InvoiceService, so a customer sees the
 * same wording whether the refusal came from adding a charge directly or from
 * generating a statement.
 */
export const CHARGE_MESSAGES = {
  labelRequired: 'A label is required for a charge.',
  amountZero: 'A charge amount cannot be zero.',
  depositNotPositive: 'A deposit must be greater than zero.',
  reasonRequired: 'A reason is required to void a charge.',
  alreadyVoided: 'That charge has already been voided.'
} as const;

@Injectable()
export class JobChargeService {
  constructor(@InjectModel(JobCharge.name) private readonly model: Model<JobChargeDocument>, @Inject(forwardRef(() => JobService)) private readonly jobService: JobService) {}

  /**
   * Every charge ever added to the job, voided ones included — the statement
   * shows those struck through with their reason, because a balance that moved
   * has to be explicable. Newest added first, matching the model's index on
   * { jobId: 1, addedAt: -1 }.
   */
  async findByJobId(jobId: string): Promise<JobCharge[]> {
    return this.model.find({ jobId }).sort({ addedAt: -1 }).exec();
  }

  /** Live charges only — what the running balance is computed from. */
  async liveByJobId(jobId: string): Promise<JobCharge[]> {
    return this.model.find({ jobId, voidedAt: null }).exec();
  }

  async addCharge(input: AddJobChargeInput, user: User): Promise<JobCharge> {
    const label = String(input.label ?? '').trim();
    if (!label) {
      throw new BadRequestException(CHARGE_MESSAGES.labelRequired);
    }

    const note = String(input.note ?? '').trim();

    const amount = round2(input.amount);
    if (input.kind === JobChargeKind.DEPOSIT) {
      if (!(amount > 0)) {
        throw new BadRequestException(CHARGE_MESSAGES.depositNotPositive);
      }
    } else if (input.kind === JobChargeKind.CUSTOM) {
      if (amount === 0) {
        throw new BadRequestException(CHARGE_MESSAGES.amountZero);
      }
    }

    // SERVICE_LINE charges are written only by createServiceLineCharges, below,
    // which invoice generation calls once it has decided what to release.
    if (String(input.kind) === JobChargeKind.SERVICE_LINE) {
      throw new BadRequestException('Service lines are released by generating an invoice, not added by hand.');
    }

    const job: any = await this.jobService.findById(String(input.jobId));
    if (!job) {
      throw new NotFoundException(`Job with ID ${input.jobId} not found`);
    }

    return this.model.create({
      // String(job._id), not the argument: the same key Booking.jobId and
      // SOW.jobId use, so the balance query joins on one value.
      jobId: String(job._id),
      kind: input.kind,
      label,
      amount,
      addedBy: user.email || user.preferred_username || 'unknown',
      addedAt: new Date(),
      ...(note ? { note } : {})
    });
  }

  /**
   * Writes one SERVICE_LINE charge per row. Called only by invoice generation,
   * after it has already decided which positions are newly being released —
   * this method does no release-ledger bookkeeping of its own. The "a position
   * with a live SERVICE_LINE is a no-op, never a duplicate" rule lives with
   * that caller, which needs the live set anyway to make that decision.
   */
  async createServiceLineCharges(
    jobId: string,
    rows: ReadonlyArray<{ serviceId: string; label: string; amount: number; sowVersionNumber?: number; sourceIndex: number }>,
    user: User
  ): Promise<JobCharge[]> {
    if (rows.length === 0) {
      return [];
    }

    const addedBy = user.email || user.preferred_username || 'unknown';
    const addedAt = new Date();
    return this.model.insertMany(
      rows.map((row) => ({
        jobId,
        kind: JobChargeKind.SERVICE_LINE,
        label: row.label,
        amount: round2(row.amount),
        serviceId: row.serviceId,
        sowVersionNumber: row.sowVersionNumber,
        sourceIndex: row.sourceIndex,
        addedBy,
        addedAt
      }))
    );
  }

  /**
   * Void, never delete: the ledger is the explanation for every move in the
   * balance. Mirrors JobPaymentService.voidPayment exactly, including the
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
