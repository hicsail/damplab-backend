import { BookingService } from './booking.service';

/**
 * A job booking whose operation had no price when it was made carries no
 * rateSnapshot. Confirming looks the price up again, so the lab can set the
 * catalog price after the fact and charge the hours by re-confirming.
 */
describe('BookingService.confirmUsage late rate resolution', () => {
  const build = (booking: any, servicePrice: number | null): { svc: BookingService; updates: any[] } => {
    const updates: any[] = [];
    const model = {
      findById: (): { exec: () => Promise<any> } => ({ exec: async (): Promise<any> => booking }),
      findByIdAndUpdate: (_id: string, update: any): { exec: () => Promise<any> } => {
        updates.push(update);
        return { exec: async (): Promise<any> => ({ ...booking, ...update.$set }) };
      }
    };
    const services = { findOne: async (): Promise<any> => (servicePrice == null ? { pricing: {} } : { pricing: { externalMarket: servicePrice } }) };
    return { svc: new BookingService(model as any, {} as any, {} as any, {} as any, services as any), updates };
  };
  const jobBooking = {
    _id: 'bk-1',
    kind: 'TIMED',
    status: 'COMPLETED',
    jobId: 'job-1',
    serviceId: 'svc-1',
    customerCategory: 'EXTERNAL_CUSTOMER_MARKET',
    startTime: new Date('2026-09-03T13:00:00Z'),
    endTime: new Date('2026-09-03T14:00:00Z')
  };

  it('snapshots the operation price set after booking, and charges the confirmed hours by it', async () => {
    const { svc, updates } = build(jobBooking, 40);
    await svc.confirmUsage('bk-1', 2.5, null, 'Admin');
    expect(updates[0].$set).toMatchObject({ usageConfirmed: true, actualHours: 2.5, rateSnapshot: 40, cost: 100 });
  });

  it('leaves the cost unset when the operation still has no price', async () => {
    const { svc, updates } = build(jobBooking, null);
    await svc.confirmUsage('bk-1', 2.5, null, 'Admin');
    expect(updates[0].$set.rateSnapshot).toBeUndefined();
    expect(updates[0].$set.cost).toBeUndefined();
    expect(updates[0].$set.actualHours).toBe(2.5);
  });

  it('keeps an existing rate snapshot rather than re-resolving it', async () => {
    const { svc, updates } = build({ ...jobBooking, rateSnapshot: 25 }, 40);
    await svc.confirmUsage('bk-1', 2, null, 'Admin');
    expect(updates[0].$set.rateSnapshot).toBeUndefined();
    expect(updates[0].$set.cost).toBe(50);
  });
});
