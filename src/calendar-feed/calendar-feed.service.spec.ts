import { CalendarFeedService, feedFilter, toFeedEvent, TOKEN_PATTERN, newFeedToken } from './calendar-feed.service';

const q = (value: unknown): any => {
  const chain: any = { select: () => chain, sort: () => chain, lean: () => chain, exec: async () => value };
  return chain;
};
const now = new Date('2026-03-01T00:00:00Z');

describe('feedFilter', () => {
  it('asks for timed, live bookings with times that ended at most 30 days ago', () => {
    expect(feedFilter(now)).toEqual({
      kind: 'TIMED',
      status: { $in: ['TENTATIVE', 'RESERVED', 'IN_USE', 'COMPLETED'] },
      startTime: { $ne: null },
      endTime: { $gte: new Date('2026-01-30T00:00:00Z') }
    });
  });
});

describe('toFeedEvent', () => {
  const s = new Date('2026-03-02T15:00:00Z');
  const e = new Date('2026-03-02T17:00:00Z');
  const u = new Date('2026-02-20T09:00:00Z');

  it('uses the item name, a stable booking UID and the last update as the stamp', () => {
    expect(toFeedEvent({ _id: 'b1', inventoryName: 'Bioanalyzer', status: 'RESERVED', startTime: s, endTime: e, updatedAt: u }, now)).toEqual({
      uid: 'booking-b1@damplab-canvas',
      start: s,
      end: e,
      summary: 'Bioanalyzer',
      tentative: false,
      stamp: u
    });
  });

  it('suffixes a tentative booking "(pending)" and marks it tentative', () => {
    expect(toFeedEvent({ _id: 'b2', inventoryName: 'Qubit', status: 'TENTATIVE', startTime: s, endTime: e, updatedAt: u }, now)).toMatchObject({ summary: 'Qubit (pending)', tentative: true });
  });

  it('says Equipment when the booking has no item name, and stamps with now when it has no update time', () => {
    expect(toFeedEvent({ _id: 'b3', inventoryName: null, status: 'IN_USE', startTime: s, endTime: e }, now)).toMatchObject({ summary: 'Equipment', stamp: now });
  });
});

describe('CalendarFeedService tokens', () => {
  const build = (tokens: any = {}): CalendarFeedService => new CalendarFeedService(tokens, {} as any);

  it('makes 32-byte base64url tokens', () => {
    expect(newFeedToken()).toMatch(TOKEN_PATTERN);
    expect(newFeedToken()).not.toBe(newFeedToken());
  });

  it('reads the caller’s token by sub, or null', async () => {
    const findOne = jest.fn(() => q(null));
    expect(await build({ findOne }).findForUser('sub-1')).toBeNull();
    expect(findOne).toHaveBeenCalledWith({ userSub: 'sub-1' });
  });

  it('creates or replaces the token in one upsert, with a fresh createdAt', async () => {
    const findOneAndUpdate = jest.fn((_f: any, update: any) => q({ userSub: 'sub-1', ...update.$set }));
    const svc = build({ findOneAndUpdate });
    const first = await svc.reset('sub-1');
    const second = await svc.reset('sub-1');
    expect(findOneAndUpdate).toHaveBeenCalledWith({ userSub: 'sub-1' }, { $set: { token: expect.stringMatching(TOKEN_PATTERN), createdAt: expect.any(Date) } }, { upsert: true, new: true });
    expect(second.token).not.toBe(first.token);
  });

  it('refuses a malformed token without touching the database', async () => {
    const findOne = jest.fn(() => q({}));
    const svc = build({ findOne });
    for (const bad of ['', 'short', 'x'.repeat(42), 'x'.repeat(44), 'x'.repeat(42) + '.', undefined, 42]) {
      expect(await svc.isLiveToken(bad)).toBe(false);
    }
    expect(findOne).not.toHaveBeenCalled();
  });

  it('accepts a well-formed token only when it is stored', async () => {
    const live = newFeedToken();
    const findOne = jest.fn((f: any) => q(f.token === live ? { token: live } : null));
    const svc = build({ findOne });
    expect(await svc.isLiveToken(live)).toBe(true);
    expect(await svc.isLiveToken(newFeedToken())).toBe(false);
  });
});

describe('CalendarFeedService.renderFeed', () => {
  it('queries with the feed filter and only the fields an event needs, oldest first', async () => {
    const select = jest.fn();
    const sort = jest.fn();
    const chain: any = {
      select: (s: string) => (select(s), chain),
      sort: (s: any) => (sort(s), chain),
      lean: () => chain,
      exec: async () => [{ _id: 'b1', inventoryName: 'Bioanalyzer', status: 'RESERVED', startTime: new Date('2026-03-02T15:00:00Z'), endTime: new Date('2026-03-02T17:00:00Z') }]
    };
    const find = jest.fn(() => chain);
    const body = await new CalendarFeedService({} as any, { find } as any).renderFeed(now);
    expect(find).toHaveBeenCalledWith(feedFilter(now));
    expect(select).toHaveBeenCalledWith('_id kind status startTime endTime inventoryName updatedAt');
    expect(sort).toHaveBeenCalledWith({ startTime: 1 });
    expect(body).toContain('UID:booking-b1@damplab-canvas\r\n');
    expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });
});
