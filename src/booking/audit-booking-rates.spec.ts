import { auditBookingRates } from './audit-booking-rates';

/** Just enough of a Db to serve `bookings` and `inventoryitems`. */
function db(bookings: unknown[], items: unknown[]): any {
  return {
    collection: (name: string): any => ({ find: () => ({ toArray: async (): Promise<unknown[]> => (name === 'bookings' ? bookings : items) }) })
  };
}

const booking = (over: any = {}): any => ({ _id: 'bk-1', inventoryItem: 'item-1', inventoryName: 'Bioanalyzer', ownerSub: 'sub-1', billingStatus: 'UNBILLED', ...over });
const item = (pricing: any, over: any = {}): any => ({ _id: 'item-1', name: 'Bioanalyzer', pricing, ...over });

describe('audit: which bookings the shared pricing chain reprices', () => {
  it('skips a booking that carries a category, where the two chains agree', async () => {
    const report = await auditBookingRates(db([booking({ customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC' })], [item({ internal: 10, externalAcademic: 25 })]));

    expect(report.categorised).toBe(1);
    expect(report.repriced).toEqual([]);
    expect(report.uncostable).toEqual([]);
  });

  it('flags the leak: an uncategorised booking taking the internal rate', async () => {
    // No legacy tier, so the old chain fell through to `internal` — handing an
    // internal rate to a caller whose category is unknown. It lands in
    // `uncostable`, not `repriced`: inventory items have no flat `price`, so the
    // new chain's entire uncategorised answer is `pricing.legacy`, and with none
    // there is no replacement rate at all. That is exactly why the plan resolves
    // the category at booking creation rather than only swapping the chain.
    const report = await auditBookingRates(db([booking({ rateSnapshot: 10 })], [item({ internal: 10, external: 30 })]));

    expect(report.uncostable).toHaveLength(1);
    expect(report.uncostable[0]).toMatchObject({ oldRate: 10, newRate: null, rateSnapshot: 10, alreadyBilled: false });
    expect(report.repriced).toEqual([]);
  });

  it('catches the coercion edge too, where the old chain invented a rate from a non-number', async () => {
    // Number(true) is 1, so `resolveRate` billed this at $1/hr. normalizePrice
    // rejects it, so the new chain resolves nothing — uncostable, like the rest.
    const report = await auditBookingRates(db([booking({ rateSnapshot: 1 })], [item({ internal: true })]));

    expect(report.uncostable).toHaveLength(1);
    expect(report.uncostable[0].oldRate).toBe(1);
    expect(report.uncostable[0].newRate).toBeNull();
  });

  it('leaves `repriced` empty, because an inventory item has no flat price to fall back to', async () => {
    // Pinning the finding, not just the code: for InventoryItem the new chain's
    // whole uncategorised answer is `pricing.legacy`, so every divergence is a
    // MISSING rate rather than a different one. `repriced` is kept for the day an
    // item does carry a flat price; if this test ever fails, that day arrived.
    const report = await auditBookingRates(
      db(
        [booking({ _id: 'a' }), booking({ _id: 'b', inventoryItem: 'item-2' }), booking({ _id: 'c', inventoryItem: 'item-3' })],
        [item({ internal: 10, external: 30 }), item({ internal: true }, { _id: 'item-2' }), item({ legacy: null, internal: 5 }, { _id: 'item-3' })]
      )
    );

    expect(report.repriced).toEqual([]);
    expect(report.uncostable).toHaveLength(3);
  });

  it('leaves an uncategorised booking alone when a legacy rate answers both chains', async () => {
    const report = await auditBookingRates(db([booking({ rateSnapshot: 15 })], [item({ legacy: 15, internal: 10 })]));

    expect(report.repriced).toEqual([]);
    expect(report.uncostable).toEqual([]);
  });

  it('flags a null legacy price, which the old chain coerced to a free booking', async () => {
    // Number(null) is 0, so `resolveRate` billed this at $0/hr; normalizePrice
    // rejects it, which is what makes the booking uncostable rather than free.
    const report = await auditBookingRates(db([booking({ rateSnapshot: 0 })], [item({ legacy: null })]));

    expect(report.uncostable).toHaveLength(1);
    expect(report.uncostable[0]).toMatchObject({ oldRate: 0, newRate: null });
  });

  it('separates uncostable from repriced, because they need different answers', async () => {
    const report = await auditBookingRates(
      db(
        [booking({ _id: 'bk-1', rateSnapshot: 10 }), booking({ _id: 'bk-2', inventoryItem: 'item-2', rateSnapshot: 20 })],
        [item({ internal: 10 }), item({ legacy: 20 }, { _id: 'item-2', name: 'Centrifuge' })]
      )
    );

    // bk-1 resolves nothing under the new chain; bk-2 is unchanged.
    expect(report.uncostable.map((r) => r.bookingId)).toEqual(['bk-1']);
    expect(report.repriced).toEqual([]);
  });

  it('flags an already-billed booking, which cannot be re-rated after the fact', async () => {
    const report = await auditBookingRates(db([booking({ rateSnapshot: 10, billingStatus: 'BILLED' })], [item({ internal: 10 })]));

    expect(report.uncostable[0].alreadyBilled).toBe(true);
  });

  it('reports catalog drift, where the stored rate is no longer what either chain gives', async () => {
    // The item was repriced after the booking was made, so the "old rate" column
    // is not what this booking would actually charge.
    const report = await auditBookingRates(db([booking({ rateSnapshot: 8 })], [item({ internal: 10 })]));

    expect(report.uncostable[0]).toMatchObject({ rateSnapshot: 8, oldRate: 10, catalogDrifted: true });
  });

  it('counts a booking whose inventory item is gone rather than guessing at it', async () => {
    const report = await auditBookingRates(db([booking({ inventoryItem: 'deleted' })], [item({ legacy: 20 })]));

    expect(report.itemMissing).toBe(1);
    expect(report.repriced).toEqual([]);
  });

  it('reports nothing to decide on an empty database', async () => {
    const report = await auditBookingRates(db([], []));

    expect(report).toMatchObject({ scannedBookings: 0, categorised: 0, itemMissing: 0, repriced: [], uncostable: [] });
  });
});
