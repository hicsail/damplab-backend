import { calendarFeedOrigin, calendarFeedUrl } from './calendar-feed-url';
import { CalendarFeedResolver } from './calendar-feed.resolver';

describe('calendarFeedOrigin', () => {
  it('uses CALENDAR_FEED_BASE_URL when set, without a trailing slash', () => {
    expect(calendarFeedOrigin('https://feeds.example.org/', { headers: { host: 'ignored:3000' }, protocol: 'http' })).toBe('https://feeds.example.org');
  });

  it('prefers the forwarded protocol and host from a proxy, first value only', () => {
    expect(calendarFeedOrigin(undefined, { headers: { 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'damplab-canvas-backend.sail.codes', host: 'internal:3000' }, protocol: 'http' })).toBe(
      'https://damplab-canvas-backend.sail.codes'
    );
  });

  it('falls back to the request itself — the backend port locally', () => {
    expect(calendarFeedOrigin(undefined, { headers: { host: 'localhost:5100' }, protocol: 'http' })).toBe('http://localhost:5100');
    expect(calendarFeedOrigin('', { headers: { host: 'localhost:5100' } })).toBe('http://localhost:5100');
  });
});

describe('calendarFeedUrl', () => {
  it('points at the .ics route', () => {
    expect(calendarFeedUrl('https://x.org', 'tok')).toBe('https://x.org/api/calendar/bookings/tok.ics');
  });
});

describe('CalendarFeedResolver', () => {
  const req = { headers: { host: 'localhost:5100' }, protocol: 'http' };
  const user: any = { sub: 'sub-1' };
  const createdAt = new Date('2026-10-27T12:00:00Z');
  const build = (feeds: any): CalendarFeedResolver => new CalendarFeedResolver(feeds, { get: () => undefined } as any);

  it('answers null until the caller has a token', async () => {
    const findForUser = jest.fn(async () => null);
    expect(await build({ findForUser }).calendarFeed(user, req)).toBeNull();
    expect(findForUser).toHaveBeenCalledWith('sub-1');
  });

  it('returns the caller’s own absolute URL', async () => {
    const feeds = { findForUser: async (): Promise<object> => ({ userSub: 'sub-1', token: 'abc', createdAt }) };
    expect(await build(feeds).calendarFeed(user, req)).toEqual({ url: 'http://localhost:5100/api/calendar/bookings/abc.ics', createdAt });
  });

  it('resets only the caller’s token', async () => {
    const reset = jest.fn(async () => ({ userSub: 'sub-1', token: 'new', createdAt }));
    expect(await build({ reset }).resetCalendarFeed(user, req)).toEqual({ url: 'http://localhost:5100/api/calendar/bookings/new.ics', createdAt });
    expect(reset).toHaveBeenCalledWith('sub-1');
  });
});
