import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { BookingService } from '../booking/booking.service';
import { Booking } from '../booking/booking.model';
import { JobPaymentService } from './job-payment.service';
import { JobChargeService } from './job-charge.service';
import { JobCharge, JobChargeKind } from './job-charge.model';
import { JobBalance } from './dto/job-balance.type';
import { SOWService } from '../sow/sow.service';
import { SowVersionService } from '../sow/sow-version.service';
import { SOWStatus } from '../sow/sow.model';
import { ProratedAdjustment, appliedAdjustmentsTotal, prorateAdjustments } from '../sow/prorate-adjustments';
import { isEquipmentLineDescription } from '../pricing/service-pricing.util';

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Confirmed, not cancelled — the only bookings that are billable. */
const isBillable = (booking: any): boolean => booking?.usageConfirmed === true && String(booking?.status) !== 'CANCELLED';

/**
 * The hours behind one line.
 *
 * `actualHours` is what confirmUsage wrote; the slot length is the fallback for
 * a confirmed booking that predates it. Deliberately NOT used to derive money —
 * see the note on equipmentCharges below.
 */
function hoursOf(booking: any): number {
  if (booking?.actualHours != null) return Number(booking.actualHours) || 0;
  if (!booking?.startTime || !booking?.endTime) return 0;
  const span = new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime();
  return Number.isFinite(span) && span > 0 ? span / 3_600_000 : 0;
}

/** One contracted line of the countersigned SOW, with its position on that version. */
export interface ContractedServiceLine {
  line: any;
  sourceIndex: number;
}

/**
 * Everything `balance` sums, plus the rows an invoice writes from — so an
 * invoice's lines and its totals can never disagree.
 */
export interface JobChargeBreakdown extends JobBalance {
  serviceLines: ContractedServiceLine[]; // the FINAL version's contracted lines, document order; empty before FINAL
  sowVersionNumber?: number; // the FINAL version those lines were read from
  customLines: JobCharge[]; // live CUSTOM, addedAt ascending
  depositCharge: JobCharge | null; // the live DEPOSIT, if any
  bookings: Booking[]; // billable, oldest slot first
  adjustments: ProratedAdjustment[]; // the rows an invoice writes, at factor 1
}

/**
 * What a job has been charged, what it has paid, and the difference — the
 * figures the job's invoice states, computed in one place.
 *
 * Every invoice restates the whole job, so there is no partial billing and no
 * proration: the countersigned SOW's contracted lines and adjustments in full,
 * confirmed equipment use, and the custom lines staff added. The deposit is the
 * first slice of that total, asked for by its own date — never added to it.
 *
 * It lives in JobPaymentModule rather than in BookingModule, SOWModule or
 * InvoiceModule because it is the one thing that needs all three: bookings,
 * the SOW, and the job's own charges and payments.
 */
@Injectable()
export class JobBalanceService {
  constructor(
    private readonly bookings: BookingService,
    private readonly payments: JobPaymentService,
    private readonly charges: JobChargeService,
    @Inject(forwardRef(() => SOWService)) private readonly sowService: SOWService,
    @Inject(forwardRef(() => SowVersionService)) private readonly sowVersionService: SowVersionService
  ) {}

  /** The billable bookings, oldest slot first — the order the invoice lists them in. */
  async confirmedBookings(jobId: string): Promise<Booking[]> {
    const all = await this.bookings.findByJob(jobId);
    return all.filter(isBillable).sort((a: any, b: any) => new Date(a.startTime ?? 0).getTime() - new Date(b.startTime ?? 0).getTime());
  }

  async chargeBreakdown(jobId: string): Promise<JobChargeBreakdown> {
    const all = await this.bookings.findByJob(jobId);
    const billable = all.filter(isBillable);
    const bookings = [...billable].sort((a: any, b: any) => new Date(a.startTime ?? 0).getTime() - new Date(b.startTime ?? 0).getTime());

    // SERVICE_LINE rows are the retired release ledger's and are ignored: the
    // countersigned SOW is the only source of service charges now.
    const liveCharges = await this.charges.liveByJobId(jobId);
    const byAdded = (a: any, b: any): number => new Date(a.addedAt ?? 0).getTime() - new Date(b.addedAt ?? 0).getTime();
    const customLines = liveCharges.filter((c: any) => c.kind === JobChargeKind.CUSTOM).sort(byAdded);
    // At most one deposit stands (JobChargeService refuses a second); the
    // newest wins should older data carry more than one.
    const deposits = liveCharges.filter((c: any) => c.kind === JobChargeKind.DEPOSIT).sort(byAdded);
    const depositCharge = deposits.length > 0 ? deposits[deposits.length - 1] : null;

    let serviceLines: ContractedServiceLine[] = [];
    let adjustments: ProratedAdjustment[] = [];
    let sowVersionNumber: number | undefined;
    const sow = await this.sowService.findByJobId(jobId);
    const active = sow ? await this.sowVersionService.getActiveVersion(String((sow as any)._id)) : null;
    // FINAL or nothing. This query loads on every job page, and anything short
    // of a countersigned version is a figure the customer has not agreed to.
    if (sow && active?.status === SOWStatus.FINAL) {
      const lines = await this.sowService.billableServiceLines(sow);
      // Contracted only. An equipment-use line is an estimate; the lab bills the
      // hours actually booked instead, through the bookings below.
      serviceLines = (lines ?? []).map((line: any, sourceIndex: number) => ({ line, sourceIndex })).filter(({ line }) => !isEquipmentLineDescription(line?.description));
      adjustments = prorateAdjustments(active.inputs?.adjustments ?? [], 1);
      sowVersionNumber = active.versionNumber;
    }

    const serviceCharges = round2(serviceLines.reduce((sum, { line }) => sum + (Number(line?.cost) || 0), 0));
    const adjustmentCharges = appliedAdjustmentsTotal(adjustments);
    // The STORED cost, never actualHours x rateSnapshot. confirmUsage keeps its
    // own fallback when a booking carries no rate, so recomputing here would
    // produce a second figure that disagrees with the one already on the
    // booking and shown on the Equipment Booking card.
    const equipmentCharges = round2(billable.reduce((sum: number, booking: any) => sum + (Number(booking.cost) || 0), 0));
    const customCharges = round2(customLines.reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0));
    const confirmedHours = round2(billable.reduce((sum: number, booking: any) => sum + hoursOf(booking), 0));
    const unconfirmedBookings = all.filter((booking: any) => booking?.usageConfirmed !== true && String(booking?.status) !== 'CANCELLED').length;

    const chargesToDate = round2(serviceCharges + adjustmentCharges + equipmentCharges + customCharges);
    const paymentsToDate = round2(await this.payments.paymentsToDate(jobId));
    // Not floored at zero: an overpayment is a credit the customer is owed,
    // and hiding it would make the next invoice bill money already paid.
    const balanceDue = round2(chargesToDate - paymentsToDate);

    const depositAmount = depositCharge ? round2((depositCharge as any).amount) : null;
    // Capped at the balance, so the deposit can never ask for more than the
    // whole invoice does.
    const depositOutstanding = depositAmount == null ? 0 : round2(Math.max(0, Math.min(depositAmount - paymentsToDate, balanceDue)));

    return {
      jobId,
      serviceCharges,
      adjustmentCharges,
      equipmentCharges,
      customCharges,
      chargesToDate,
      paymentsToDate,
      balanceDue,
      depositAmount,
      depositDueDate: (depositCharge as any)?.dueDate ?? null,
      depositOutstanding,
      confirmedHours,
      unconfirmedBookings,
      serviceLines,
      sowVersionNumber,
      customLines,
      depositCharge,
      bookings,
      adjustments
    };
  }

  async balance(jobId: string): Promise<JobBalance> {
    const b = await this.chargeBreakdown(jobId);
    return {
      jobId: b.jobId,
      serviceCharges: b.serviceCharges,
      adjustmentCharges: b.adjustmentCharges,
      equipmentCharges: b.equipmentCharges,
      customCharges: b.customCharges,
      chargesToDate: b.chargesToDate,
      paymentsToDate: b.paymentsToDate,
      balanceDue: b.balanceDue,
      depositAmount: b.depositAmount,
      depositDueDate: b.depositDueDate,
      depositOutstanding: b.depositOutstanding,
      confirmedHours: b.confirmedHours,
      unconfirmedBookings: b.unconfirmedBookings
    };
  }
}
