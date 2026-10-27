import { getModelToken } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import * as request from 'supertest';
import { gql, gqlError, resetDb, startTestApp, stopTestApp, TestApp } from './harness';
import { Booking } from '../../src/booking/booking.model';
import { CalendarFeedToken } from '../../src/calendar-feed/calendar-feed-token.model';
import { newFeedToken } from '../../src/calendar-feed/calendar-feed.service';

const FEED = '{ calendarFeed { url createdAt } }';
const RESET = 'mutation { resetCalendarFeed { url createdAt } }';
const DAY = 24 * 60 * 60 * 1000;
const pathOf = (url: string): string => new URL(url).pathname;

describe('calendar feed (booking-calendar)', () => {
  let ctx: TestApp;
  beforeAll(async () => (ctx = await startTestApp()));
  afterAll(async () => stopTestApp(ctx));
  beforeEach(async () => resetDb(ctx));

  const get = (path: string): request.Test => request(ctx.app.getHttpServer()).get(path);
  const tokens = (): mongoose.Model<any> => ctx.app.get(getModelToken(CalendarFeedToken.name));

  it('creates the link once, serves it, and kills the old one on reset (1, 2, 10, 11)', async () => {
    expect((await gql(ctx, 'staff', FEED)).calendarFeed).toBeNull();
    const first = (await gql(ctx, 'staff', RESET)).resetCalendarFeed;
    expect((await gql(ctx, 'staff', FEED)).calendarFeed.url).toBe(first.url);

    const ok = await get(pathOf(first.url));
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(ok.text).toContain('X-WR-CALNAME:DAMP Lab equipment\r\n');

    const second = (await gql(ctx, 'staff', RESET)).resetCalendarFeed;
    expect(second.url).not.toBe(first.url);
    const gone = await get(pathOf(first.url));
    expect(gone.status).toBe(404);
    expect(gone.text).toBe('');
    expect((await get(pathOf(second.url))).status).toBe(200);
  });

  it('refuses a client both operations and creates no token (12)', async () => {
    expect(await gqlError(ctx, 'customer', FEED)).toContain('Missing permission: inventory:schedule');
    expect(await gqlError(ctx, 'customer', RESET)).toContain('Missing permission: inventory:schedule');
    expect(await tokens().countDocuments()).toBe(0);
  });

  it('lists live timed bookings by item and time only, the same for every token (3, 4, 5, 6)', async () => {
    const bookings: mongoose.Model<any> = ctx.app.get(getModelToken(Booking.name));
    const now = Date.now();
    const secret = {
      ownerSub: 'owner-sub',
      ownerEmail: 'olive@secret.test',
      ownerName: 'Olive Owner',
      ownerInstitution: 'Secret University',
      notes: 'Job #12345 · Bioanalyzer time',
      jobId: 'job-secret-id',
      rateSnapshot: 41.5,
      cost: 83.25
    };
    const timed = (over: Record<string, unknown>): Record<string, unknown> => ({ inventoryItem: new mongoose.Types.ObjectId(), kind: 'TIMED', ...secret, ...over });
    await bookings.create([
      timed({ inventoryName: 'Bioanalyzer', status: 'RESERVED', startTime: new Date(now + DAY), endTime: new Date(now + DAY + 2 * 3600e3) }),
      timed({ inventoryName: 'Qubit', status: 'TENTATIVE', startTime: new Date(now + 2 * DAY), endTime: new Date(now + 2 * DAY + 3600e3) }),
      timed({ inventoryName: 'PCR; rack 2, left', status: 'IN_USE', startTime: new Date(now - 3600e3), endTime: new Date(now + 3600e3) }),
      timed({ inventoryName: 'Recent Machine', status: 'COMPLETED', startTime: new Date(now - 29 * DAY - 3600e3), endTime: new Date(now - 29 * DAY) }),
      timed({ inventoryName: 'Old Machine', status: 'COMPLETED', startTime: new Date(now - 31 * DAY - 3600e3), endTime: new Date(now - 31 * DAY) }),
      timed({ inventoryName: 'Cancelled Machine', status: 'CANCELLED', startTime: new Date(now + DAY), endTime: new Date(now + DAY + 3600e3) }),
      timed({ inventoryName: 'Timeless Machine', status: 'RESERVED' }),
      { inventoryItem: new mongoose.Types.ObjectId(), kind: 'QUANTITY', inventoryName: 'Pipette Tips', status: 'RESERVED', quantity: 5, usedOn: new Date(now), ...secret }
    ]);

    const mine = (await gql(ctx, 'staff', RESET)).resetCalendarFeed;
    const other = newFeedToken();
    await tokens().create({ userSub: 'someone-else', token: other, createdAt: new Date() });

    const body = (await get(pathOf(mine.url))).text;
    const unfolded = body.replace(/\r\n /g, '');
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(4);
    expect(unfolded).toContain('SUMMARY:Bioanalyzer\r\n');
    expect(unfolded).toContain('SUMMARY:Qubit (pending)\r\nSTATUS:TENTATIVE\r\n');
    expect(unfolded).toContain('SUMMARY:PCR\\; rack 2\\, left\r\n');
    expect(unfolded).toContain('SUMMARY:Recent Machine\r\n');
    for (const absent of ['Old Machine', 'Cancelled Machine', 'Timeless Machine', 'Pipette Tips']) expect(unfolded).not.toContain(absent);
    for (const leak of ['Olive', 'olive@secret.test', 'owner-sub', 'Secret University', 'Job #12345', 'job-secret-id', '41.5', '83.25']) expect(unfolded).not.toContain(leak);
    const props = unfolded
      .split('\r\n')
      .filter((l) => l && !/^(BEGIN|END|VERSION|PRODID|CALSCALE|METHOD|X-WR-CALNAME)[:]/.test(l))
      .map((l) => l.split(':')[0]);
    expect(new Set(props)).toEqual(new Set(['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY', 'STATUS', 'TRANSP']));

    expect((await get(`/api/calendar/bookings/${other}.ics`)).text).toBe(body);
  });
});
