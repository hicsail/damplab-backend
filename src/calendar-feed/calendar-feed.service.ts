import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingDocument, BookingKind, BookingStatus } from '../booking/booking.model';
import { CalendarFeedToken, CalendarFeedTokenDocument } from './calendar-feed-token.model';
import { ICalEvent, toICalendar } from './ical';

export const FEED_STATUSES: BookingStatus[] = [BookingStatus.TENTATIVE, BookingStatus.RESERVED, BookingStatus.IN_USE, BookingStatus.COMPLETED];
export const FEED_LOOKBACK_DAYS = 30;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newFeedToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Timed, live bookings that have times and ended no more than FEED_LOOKBACK_DAYS ago.
 * Workflow-operation holds are not `Booking` documents, which is why they never appear.
 */
export function feedFilter(now: Date): Record<string, unknown> {
  const cutoff = new Date(now.getTime() - FEED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  return {
    kind: BookingKind.TIMED,
    status: { $in: FEED_STATUSES },
    startTime: { $ne: null },
    endTime: { $gte: cutoff }
  };
}

type FeedBooking = { _id: unknown; inventoryName?: string | null; status: string; startTime: Date; endTime: Date; updatedAt?: Date | null };

export function toFeedEvent(b: FeedBooking, now: Date): ICalEvent {
  const tentative = b.status === BookingStatus.TENTATIVE;
  return {
    uid: `booking-${String(b._id)}@damplab-canvas`,
    start: new Date(b.startTime),
    end: new Date(b.endTime),
    summary: (b.inventoryName || 'Equipment') + (tentative ? ' (pending)' : ''),
    tentative,
    stamp: b.updatedAt ? new Date(b.updatedAt) : now
  };
}

@Injectable()
export class CalendarFeedService {
  constructor(@InjectModel(CalendarFeedToken.name) private readonly tokens: Model<CalendarFeedTokenDocument>, @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>) {}

  findForUser(userSub: string): Promise<CalendarFeedToken | null> {
    return this.tokens.findOne({ userSub }).lean().exec() as Promise<CalendarFeedToken | null>;
  }

  reset(userSub: string): Promise<CalendarFeedToken> {
    return this.tokens
      .findOneAndUpdate({ userSub }, { $set: { token: newFeedToken(), createdAt: new Date() } }, { upsert: true, new: true })
      .lean()
      .exec() as Promise<CalendarFeedToken>;
  }

  async isLiveToken(token: unknown): Promise<boolean> {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return false;
    return !!(await this.tokens.findOne({ token }).lean().exec());
  }

  async renderFeed(now: Date = new Date()): Promise<string> {
    const rows = await this.bookings.find(feedFilter(now)).select('_id kind status startTime endTime inventoryName updatedAt').sort({ startTime: 1 }).lean().exec();
    return toICalendar((rows as FeedBooking[]).map((b) => toFeedEvent(b, now)));
  }
}
