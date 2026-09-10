import { AvailabilityService } from './availability.service';

// A chainable stand-in for `model.find(filter).select().lean().exec()` that
// records the filter it was queried with.
const fakeModel = (rows: any[] = []): { calls: any[]; find: (filter: any) => any } => {
  const calls: any[] = [];
  const chain: any = { select: (): any => chain, lean: (): any => chain, exec: async (): Promise<any[]> => rows };
  return {
    calls,
    find: (filter: any): any => {
      calls.push(filter);
      return chain;
    }
  };
};

describe('AvailabilityService.findItemConflicts — which bookings hold a slot', () => {
  const itemId = '6a9071a476a66b88f3059da1';
  const start = new Date('2026-09-27T13:00:00Z');
  const end = new Date('2026-09-27T14:00:00Z');

  it('counts a usage-confirmed (COMPLETED) booking as still holding its slot', async () => {
    // Confirming usage flips a booking to COMPLETED, and staff may confirm a
    // booking before it runs. It must keep blocking the slot and keep showing
    // as busy on every other calendar, or the item gets double-booked.
    const bookings = fakeModel();
    const service = new AvailabilityService(fakeModel() as any, bookings as any);
    await service.findItemConflicts({ itemIds: [itemId], start, end });
    expect(bookings.calls[0].status.$in).toEqual(expect.arrayContaining(['RESERVED', 'IN_USE', 'COMPLETED']));
  });

  it('never counts a cancelled booking', async () => {
    const bookings = fakeModel();
    const service = new AvailabilityService(fakeModel() as any, bookings as any);
    await service.findItemConflicts({ itemIds: [itemId], start, end });
    expect(bookings.calls[0].status.$in).not.toContain('CANCELLED');
  });
});
