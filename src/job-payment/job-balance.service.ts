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
import { ProratedAdjustment, appliedAdjustmentsTotal, prorateAdjustments, prorationFactorFor } from '../sow/prorate-adjustments';
import { splitContractedLines, sumLineCosts } from '../pricing/service-pricing.util';

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

/**
 * The whole charge ledger's breakdown: everything `balance` sums, plus the
 * rows a statement writes from — released service lines, custom lines, live
 * deposits, billable bookings and the prorated adjustments, all at the same
 * proration factor the balance itself used.
 */
export interface JobChargeBreakdown extends JobBalance {
  serviceLines: JobCharge[]; // live SERVICE_LINE, ascending sourceIndex
  customLines: JobCharge[]; // live CUSTOM, addedAt ascending
  depositLines: JobCharge[]; // live DEPOSIT — EMPTY when depositsDropped
  bookings: Booking[]; // billable, oldest slot first
  adjustments: ProratedAdjustment[]; // the rows an invoice writes
  prorationFactor: number;
}

/**
 * What a job has been charged across its whole ledger, what it has paid, and
 * the difference — the figures a statement of account states, computed in one
 * place so its lines and its totals can never disagree.
 *
 * It lives in JobPaymentModule rather than in BookingModule, SOWModule or
 * InvoiceModule because it is the one thing that needs all three: bookings,
 * the SOW's released services and adjustments, and the job's own charge
 * ledger and payments.
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

    const liveCharges = await this.charges.liveByJobId(jobId);
    const serviceLines = liveCharges.filter((c: any) => c.kind === JobChargeKind.SERVICE_LINE).sort((a: any, b: any) => (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
    const customLines = liveCharges.filter((c: any) => c.kind === JobChargeKind.CUSTOM).sort((a: any, b: any) => new Date(a.addedAt ?? 0).getTime() - new Date(b.addedAt ?? 0).getTime());
    const rawDeposits = liveCharges.filter((c: any) => c.kind === JobChargeKind.DEPOSIT).sort((a: any, b: any) => new Date(a.addedAt ?? 0).getTime() - new Date(b.addedAt ?? 0).getTime());

    const serviceCharges = round2(serviceLines.reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0));
    const customCharges = round2(customLines.reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0));
    const rawDepositsTotal = round2(rawDeposits.reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0));

    // A deposit is money owed before any service has been released. Once one
    // has, the job has moved past "up front" and the deposit no longer belongs
    // on the running balance — the payment made against it stays counted in
    // paymentsToDate, only the charge line drops.
    const depositsDropped = rawDeposits.length > 0 && serviceLines.length > 0;
    const depositCharges = depositsDropped ? 0 : rawDepositsTotal;
    const depositLines = depositsDropped ? [] : rawDeposits;

    // The STORED cost, never actualHours x rateSnapshot. confirmUsage keeps its
    // own fallback when a booking carries no rate, so recomputing here would
    // produce a second figure that disagrees with the one already on the
    // booking and shown on the Equipment Booking card.
    const equipmentCharges = round2(billable.reduce((sum: number, booking: any) => sum + (Number(booking.cost) || 0), 0));
    const confirmedHours = round2(billable.reduce((sum: number, booking: any) => sum + hoursOf(booking), 0));
    const unconfirmedBookings = all.filter((booking: any) => booking?.usageConfirmed !== true && String(booking?.status) !== 'CANCELLED').length;

    let adjustments: ProratedAdjustment[] = [];
    let prorationFactor = 0;
    const sow = await this.sowService.findByJobId(jobId);
    const active = sow ? await this.sowVersionService.getActiveVersion(String((sow as any)._id)) : null;
    // FINAL or nothing. There is deliberately no `sow.pricing.adjustments`
    // fallback here: `createForJob` can afford one because its countersign gate
    // runs first, but this query loads on every job page, and a withdrawn SOW
    // would otherwise prorate against the live billing core the workflow sync
    // rewrites — a figure no document ever stated.
    if (sow && active?.status === SOWStatus.FINAL) {
      const lines = await this.sowService.billableServiceLines(sow);
      // Contracted only, matching the SOW's own baseCost. Equipment lines are
      // estimates the lab never bills as a fixed figure, so prorating a discount
      // against them would apply a fraction of it and leave the rest unapplied on
      // every statement.
      const sowServicesSubtotal = sumLineCosts(splitContractedLines(lines as any).contracted);
      prorationFactor = prorationFactorFor(serviceCharges, sowServicesSubtotal);
      adjustments = prorateAdjustments(active.inputs?.adjustments ?? [], prorationFactor);
    }
    const adjustmentCharges = appliedAdjustmentsTotal(adjustments);

    const chargesToDate = round2(serviceCharges + adjustmentCharges + equipmentCharges + customCharges + depositCharges);
    const paymentsToDate = round2(await this.payments.paymentsToDate(jobId));

    return {
      jobId,
      serviceCharges,
      adjustmentCharges,
      equipmentCharges,
      customCharges,
      depositCharges,
      depositsDropped,
      chargesToDate,
      paymentsToDate,
      // Not floored at zero: an overpayment is a credit the customer is owed,
      // and hiding it would make the next invoice bill money already paid.
      balanceDue: round2(chargesToDate - paymentsToDate),
      confirmedHours,
      unconfirmedBookings,
      serviceLines,
      customLines,
      depositLines,
      bookings,
      adjustments,
      prorationFactor
    };
  }

  async balance(jobId: string): Promise<JobBalance> {
    const {
      jobId: id,
      serviceCharges,
      adjustmentCharges,
      equipmentCharges,
      customCharges,
      depositCharges,
      depositsDropped,
      chargesToDate,
      paymentsToDate,
      balanceDue,
      confirmedHours,
      unconfirmedBookings
    } = await this.chargeBreakdown(jobId);
    return {
      jobId: id,
      serviceCharges,
      adjustmentCharges,
      equipmentCharges,
      customCharges,
      depositCharges,
      depositsDropped,
      chargesToDate,
      paymentsToDate,
      balanceDue,
      confirmedHours,
      unconfirmedBookings
    };
  }
}
