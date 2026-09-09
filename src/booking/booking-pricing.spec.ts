import { BookingService } from './booking.service';
import { CustomerCategory } from '../pricing/customer-category';

/**
 * What a booking is priced at, and whose category decides it.
 *
 * `resolveRate` used to be a second copy of the chain `service-pricing.util.ts`
 * documents as THE one. On the four named categories the two agreed; they diverged
 * for an uncategorised caller, where it fell through to `pricing.internal` — the
 * leak `pricing-visibility.ts` exists to prevent — and where `Number(null)` is `0`,
 * making a null price a free booking.
 *
 * Swapping the chain alone would have made uncategorised bookings uncostable, so
 * the category is now resolved at creation. From the **owner**, not the requester:
 * staff book on other people's behalf, and pricing a colleague's booking at staff
 * rates is the mistake `AddNodeInputPipe` makes with `node.price`.
 */

const ITEM = {
  id: 'item-1',
  name: 'Bioanalyzer',
  type: 'EQUIPMENT',
  rateType: 'HOURLY',
  bookable: true,
  isDeleted: false,
  pricing: { internal: 10, externalAcademic: 25, externalMarket: 40, legacy: 15 }
};

interface HarnessOptions {
  item?: any;
  /** What the Keycloak resolver answers, keyed by the sub it is asked about. */
  categoryBySub?: Record<string, CustomerCategory | undefined>;
  /** Set to have the resolver throw, standing in for an unreachable Keycloak. */
  keycloakDown?: boolean;
}

function harness(opts: HarnessOptions = {}): { service: BookingService; created: any[]; askedFor: any[] } {
  const created: any[] = [];
  const askedFor: any[] = [];

  const model: any = {
    create: async (doc: any): Promise<any> => {
      created.push(doc);
      return doc;
    }
  };
  const inventoryService: any = { find: async (): Promise<any> => opts.item ?? ITEM };
  const availability: any = { findItemConflicts: async (): Promise<any[]> => [] };
  const keycloakService: any = {
    resolveCustomerCategoryForUser: async (user: any): Promise<CustomerCategory | undefined> => {
      askedFor.push(user);
      // The real one swallows its own failures and returns undefined; mirroring
      // that here is what makes the "Keycloak is down" case a $0-free booking
      // rather than a booking nobody can make.
      if (opts.keycloakDown) return undefined;
      return opts.categoryBySub?.[String(user?.sub ?? '')];
    }
  };

  return { service: new BookingService(model, inventoryService, availability, keycloakService), created, askedFor };
}

const timedInput = (over: any = {}): any => ({
  inventoryItemId: 'item-1',
  startTime: '2026-09-10T09:00:00.000Z',
  endTime: '2026-09-10T11:00:00.000Z',
  ...over
});

const self = { sub: 'sub-owner', email: 'owner@bu.edu', name: 'Owen Owner' };

describe('a booking is priced at its owner’s category', () => {
  it('resolves the category from the booker’s own token when they book for themselves', async () => {
    const { service, created, askedFor } = harness({ categoryBySub: { 'sub-owner': CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC } });

    await service.create(timedInput(), { ...self, realm_access: { roles: [] }, groups: ['external-customer-academic'] });

    expect(created[0]).toMatchObject({ customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC', rateSnapshot: 25 });
    // Claims passed through, so the ordinary case costs no Admin API round trip.
    expect(askedFor[0]).toMatchObject({ sub: 'sub-owner', groups: ['external-customer-academic'] });
  });

  it('resolves the OWNER’s category when staff book on someone else’s behalf', async () => {
    const { service, created, askedFor } = harness({
      categoryBySub: { 'sub-staff': CustomerCategory.INTERNAL_CUSTOMERS, 'sub-someone-else': CustomerCategory.EXTERNAL_CUSTOMER_MARKET }
    });

    await service.create(timedInput({ ownerSub: 'sub-someone-else', ownerEmail: 'them@example.com' }), {
      sub: 'sub-staff',
      email: 'tech@bu.edu',
      realm_access: { roles: ['damplab-staff'] }
    });

    // $40, not the $10 the staff member's own tier would have given.
    expect(created[0]).toMatchObject({ customerCategory: 'EXTERNAL_CUSTOMER_MARKET', rateSnapshot: 40 });
    // Asked about the owner, and without the staff member's claims, which would
    // otherwise short-circuit to the wrong tier.
    expect(askedFor[0]).toEqual({ sub: 'sub-someone-else' });
  });

  it('honours an explicit category, which is the staff override for a customer with no group yet', async () => {
    // The resolver strips this field for anyone who cannot manage others' bookings
    // (see booking-category-override.spec.ts), so by the time the service sees one
    // it came from staff.
    const { service, created, askedFor } = harness({ categoryBySub: { 'sub-owner': CustomerCategory.INTERNAL_CUSTOMERS } });

    await service.create(timedInput({ customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC' }), self);

    expect(created[0].rateSnapshot).toBe(25);
    expect(askedFor).toEqual([]);
  });
});

describe('the uncategorised chain no longer leaks the internal rate', () => {
  it('ends at the legacy tier rather than falling through to internal', async () => {
    const { service, created } = harness({ keycloakDown: true });

    await service.create(timedInput(), self);

    // `resolveRate` returned `legacy ?? internal ?? external`; this ends at legacy.
    expect(created[0]).toMatchObject({ customerCategory: undefined, rateSnapshot: 15 });
  });

  it('resolves nothing at all when there is no legacy tier either', async () => {
    const { service, created } = harness({ keycloakDown: true, item: { ...ITEM, pricing: { internal: 10, external: 30 } } });

    await service.create(timedInput(), self);

    // Uncostable rather than billed at the internal rate. generateBilling refuses
    // it; see usage-billing-unrated.spec.ts.
    expect(created[0].rateSnapshot).toBeUndefined();
    expect(created[0].cost).toBeUndefined();
  });

  it('treats a null price as no price, not as free', async () => {
    // `Number(null)` is 0, which billed this at $0/hr under the old chain.
    const { service, created } = harness({ keycloakDown: true, item: { ...ITEM, pricing: { legacy: null, internal: 5 } } });

    await service.create(timedInput(), self);

    expect(created[0].rateSnapshot).toBeUndefined();
  });

  it('still lets the booking be made when Keycloak is unreachable', async () => {
    // A pricing outage must not stop someone booking a machine — the refusal
    // belongs at billing time, where a person can act on it.
    const { service, created } = harness({ keycloakDown: true });

    await expect(service.create(timedInput(), self)).resolves.toBeDefined();
    expect(created).toHaveLength(1);
  });
});

describe('costs still compute from the resolved rate', () => {
  it('multiplies hours by the rate for a timed booking', async () => {
    const { service, created } = harness({ categoryBySub: { 'sub-owner': CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC } });

    await service.create(timedInput(), self);

    expect(created[0].cost).toBe(50); // 2 hours at $25
  });

  it('multiplies quantity by the rate for a per-unit booking', async () => {
    const { service, created } = harness({
      item: { ...ITEM, rateType: 'PER_UNIT', type: 'CONSUMABLE' },
      categoryBySub: { 'sub-owner': CustomerCategory.INTERNAL_CUSTOMERS }
    });

    await service.create({ inventoryItemId: 'item-1', quantity: 3 } as any, self);

    expect(created[0].cost).toBe(30); // 3 units at $10
  });

  it('leaves cost undefined rather than zero when no rate resolved', async () => {
    const { service, created } = harness({ keycloakDown: true, item: { ...ITEM, pricing: { internal: 10 } } });

    await service.create(timedInput(), self);

    expect(created[0].cost).toBeUndefined();
  });
});
