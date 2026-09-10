import { UsageBillingService } from './usage-billing.service';

/**
 * A booking with no rate is refused, not billed at zero.
 *
 * `rateSnapshot` is written once at booking creation and never revisited, so a
 * booking made while its owner was in no Keycloak pricing group — or while the
 * Admin API was unreachable — carries no rate for the rest of its life. `toLineItem`
 * reads `b.cost ?? 0`, which meant those went onto a real invoice as **$0, in
 * silence**, with no staff override anywhere that could correct it.
 *
 * Refused at billing rather than at booking on purpose: a pricing outage must not
 * stop someone booking a machine, and by the time anyone bills there is a person
 * reading the message who can give the owner a group.
 */

const booking = (over: any = {}): any => ({
  _id: 'bk-1',
  ownerSub: 'sub-1',
  ownerEmail: 'owner@bu.edu',
  inventoryName: 'Bioanalyzer',
  status: 'RESERVED',
  usageConfirmed: true,
  billingStatus: 'UNBILLED',
  kind: 'TIMED',
  actualHours: 2,
  rateSnapshot: 25,
  cost: 50,
  ...over
});

function harness(bookings: any[]): { service: UsageBillingService } {
  const bookingService: any = { getByIds: async (): Promise<any[]> => bookings, markBilled: async (): Promise<void> => undefined };
  const model = (): any => ({
    create: async (doc: any): Promise<any> => ({ ...doc, _id: 'new' }),
    countDocuments: () => ({ exec: async (): Promise<number> => 0 }),
    findOne: () => ({ sort: () => ({ exec: async (): Promise<any> => null }), exec: async (): Promise<any> => null })
  });
  return { service: new UsageBillingService(model(), model(), bookingService) };
}

describe('generateBilling refuses a booking that has no rate', () => {
  it('names the item and says why, rather than invoicing it at $0', async () => {
    const { service } = harness([booking({ rateSnapshot: undefined, cost: undefined })]);

    await expect(service.generateBilling({ ownerSub: 'sub-1', bookingIds: ['bk-1'] } as any, 'tech@bu.edu')).rejects.toThrow(/"Bioanalyzer" has no rate/i);
  });

  it('tells staff what to do about it', async () => {
    const { service } = harness([booking({ rateSnapshot: null, cost: 0 })]);

    await expect(service.generateBilling({ ownerSub: 'sub-1', bookingIds: ['bk-1'] } as any, 'tech@bu.edu')).rejects.toThrow(/no pricing group when it was booked/i);
  });

  it('refuses the whole batch, so one unrated line cannot ride along on a good one', async () => {
    const { service } = harness([booking(), booking({ _id: 'bk-2', inventoryName: 'Centrifuge', rateSnapshot: undefined, cost: undefined })]);

    await expect(service.generateBilling({ ownerSub: 'sub-1', bookingIds: ['bk-1', 'bk-2'] } as any, 'tech@bu.edu')).rejects.toThrow(/"Centrifuge" has no rate/i);
  });

  it('keeps a genuine zero rate billable, because free is a real price', async () => {
    // The check is on the rate being absent, not on the cost being 0 — an item
    // priced at $0 for a tier is a decision somebody made.
    const { service } = harness([booking({ rateSnapshot: 0, cost: 0 })]);

    await expect(service.generateBilling({ ownerSub: 'sub-1', bookingIds: ['bk-1'] } as any, 'tech@bu.edu')).resolves.toBeDefined();
  });

  it('still bills a rated booking unchanged', async () => {
    const { service } = harness([booking()]);

    await expect(service.generateBilling({ ownerSub: 'sub-1', bookingIds: ['bk-1'] } as any, 'tech@bu.edu')).resolves.toBeDefined();
  });
});

/**
 * `generateBilling` re-fetches bookings by id via `BookingService.getByIds`, which
 * has no `jobId` filter — the picker and owner list are filtered, but a job-scoped
 * booking id reaching this mutation by any other path would otherwise be billed
 * here too, double-billing the same hours to both the job and the walk-up owner.
 */
describe('generateBilling refuses a job-scoped booking', () => {
  it('names the item and points at the job invoice, creating nothing', async () => {
    const created: any[] = [];
    const bookingService: any = {
      getByIds: async (): Promise<any[]> => [booking({ jobId: 'job-1' })],
      markBilled: async (): Promise<void> => {
        created.push('markBilled-called');
      }
    };
    const model = (): any => ({
      create: async (doc: any): Promise<any> => {
        created.push(doc);
        return { ...doc, _id: 'new' };
      },
      countDocuments: () => ({ exec: async (): Promise<number> => 0 }),
      findOne: () => ({ sort: () => ({ exec: async (): Promise<any> => null }), exec: async (): Promise<any> => null })
    });
    const service = new UsageBillingService(model(), model(), bookingService);

    await expect(service.generateBilling({ ownerSub: 'sub-1', bookingIds: ['bk-1'] } as any, 'tech@bu.edu')).rejects.toThrow(
      `"Bioanalyzer" is booked against a job and is billed through that job's equipment invoices.`
    );
    expect(created).toEqual([]);
  });
});
