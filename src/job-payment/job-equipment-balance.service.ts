import { Injectable } from '@nestjs/common';
import { BookingService } from '../booking/booking.service';
import { Booking } from '../booking/booking.model';
import { JobPaymentService } from './job-payment.service';
import { JobEquipmentBalance } from './dto/job-equipment-balance.type';

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
 * see the note on chargesToDate below.
 */
function hoursOf(booking: any): number {
  if (booking?.actualHours != null) return Number(booking.actualHours) || 0;
  if (!booking?.startTime || !booking?.endTime) return 0;
  const span = new Date(booking.endTime).getTime() - new Date(booking.startTime).getTime();
  return Number.isFinite(span) && span > 0 ? span / 3_600_000 : 0;
}

/**
 * What a job has been charged for equipment, what it has paid, and the
 * difference — the three figures an equipment invoice states, computed in one
 * place so the invoice's lines and its totals can never disagree.
 *
 * It lives in JobPaymentModule rather than in BookingModule or InvoiceModule
 * because it is the one thing that needs both halves: JobPaymentModule imports
 * BookingModule and nothing imports JobPaymentModule back, so InvoiceModule
 * reaches bookings and payments through this single import with no forwardRef.
 */
@Injectable()
export class JobEquipmentBalanceService {
  constructor(private readonly bookings: BookingService, private readonly payments: JobPaymentService) {}

  /** The billable bookings, oldest slot first — the order the invoice lists them in. */
  async confirmedBookings(jobId: string): Promise<Booking[]> {
    const all = await this.bookings.findByJob(jobId);
    return all.filter(isBillable).sort((a: any, b: any) => new Date(a.startTime ?? 0).getTime() - new Date(b.startTime ?? 0).getTime());
  }

  async balance(jobId: string): Promise<JobEquipmentBalance> {
    const all = await this.bookings.findByJob(jobId);
    const billable = all.filter(isBillable);

    // The STORED cost, never actualHours x rateSnapshot. confirmUsage keeps its
    // own fallback when a booking carries no rate, so recomputing here would
    // produce a second figure that disagrees with the one already on the
    // booking and shown on the Equipment Booking card.
    const chargesToDate = round2(billable.reduce((sum, booking: any) => sum + (Number(booking.cost) || 0), 0));
    const confirmedHours = round2(billable.reduce((sum, booking) => sum + hoursOf(booking), 0));
    const unconfirmedBookings = all.filter((booking: any) => booking?.usageConfirmed !== true && String(booking?.status) !== 'CANCELLED').length;
    const paymentsToDate = round2(await this.payments.paymentsToDate(jobId));

    return {
      jobId,
      chargesToDate,
      paymentsToDate,
      // Not floored at zero: an overpayment is a credit the customer is owed,
      // and hiding it would make the next invoice bill money already paid.
      balanceDue: round2(chargesToDate - paymentsToDate),
      confirmedHours,
      unconfirmedBookings
    };
  }
}
