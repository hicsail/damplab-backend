import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JobPayment, JobPaymentDocument } from './job-payment.model';
import { RecordJobPaymentInput } from './dto/record-job-payment.input';
import { JobService } from '../job/job.service';
import { User } from '../auth/user.interface';

/** Money rounding, matching InvoiceService — a balance must not carry float noise. */
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

@Injectable()
export class JobPaymentService {
  constructor(@InjectModel(JobPayment.name) private readonly model: Model<JobPaymentDocument>, @Inject(forwardRef(() => JobService)) private readonly jobService: JobService) {}

  /**
   * Every payment ever recorded on the job, voided ones included — the job page
   * shows those struck through with their reason, because a balance that moved
   * back up has to be explicable. Newest received first, matching the model's
   * index on { jobId: 1, receivedOn: -1 }.
   */
  async findByJobId(jobId: string): Promise<JobPayment[]> {
    return this.model.find({ jobId }).sort({ receivedOn: -1 }).exec();
  }

  /** The job's live payments, oldest received first — the order an invoice lists them in. */
  async livePayments(jobId: string): Promise<JobPayment[]> {
    return this.model.find({ jobId, voidedAt: null }).sort({ receivedOn: 1 }).exec();
  }

  /** What the job has paid: live payments only. */
  async paymentsToDate(jobId: string): Promise<number> {
    const live = await this.model.find({ jobId, voidedAt: null }).exec();
    return round2(live.reduce((sum, payment) => sum + (Number((payment as any).amount) || 0), 0));
  }

  /**
   * Record money received against the job — never against one invoice. Only
   * one invoice stands at a time and every version restates the job's payments,
   * so pinning a payment to a document would only go stale.
   */
  async record(input: RecordJobPaymentInput, user: User): Promise<JobPayment> {
    const amount = round2(input.amount);
    if (!(amount > 0)) {
      throw new BadRequestException('Payment amount must be greater than zero.');
    }

    const job: any = await this.jobService.findById(String(input.jobId));
    if (!job) {
      throw new NotFoundException(`Job with ID ${input.jobId} not found`);
    }

    const reference = String(input.reference ?? '').trim();
    const note = String(input.note ?? '').trim();

    return this.model.create({
      // String(job._id), not the argument: the same key Booking.jobId and
      // SOW.jobId use, so the balance query joins on one value.
      jobId: String(job._id),
      amount,
      receivedOn: input.receivedOn,
      reference: reference || undefined,
      note: note || undefined,
      recordedBy: user.email || user.preferred_username || 'unknown',
      recordedAt: new Date()
    });
  }

  /**
   * Void, never delete: the ledger is the explanation for every move in the
   * balance. Issued invoices are deliberately untouched — each states the
   * payments as at its own date, and re-writing an issued document because a
   * cheque bounced would falsify what was sent. The next version restates it.
   *
   * Voiding an already-void payment is refused rather than silently accepted:
   * it almost always means a stale list, and the second void would overwrite
   * the first reason and actor.
   */
  async voidPayment(id: string, reason: string, user: User): Promise<JobPayment> {
    const trimmed = String(reason ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('A reason is required to void a payment.');
    }

    const payment: any = await this.model.findById(id).exec();
    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }
    if (payment.voidedAt) {
      throw new BadRequestException('That payment has already been voided.');
    }

    const voidedBy = user.email || user.preferred_username || 'unknown';
    // Conditional on still being live, so two staff voiding at once cannot
    // overwrite each other's reason.
    const updated = await this.model.findOneAndUpdate({ _id: id, voidedAt: null }, { $set: { voidedAt: new Date(), voidedBy, voidReason: trimmed } }, { new: true }).exec();
    if (!updated) {
      throw new BadRequestException('That payment has already been voided.');
    }
    return updated;
  }
}
