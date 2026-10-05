import { BookingResolver } from './booking.resolver';
import { User } from '../auth/user.interface';

/**
 * Who may name a booking's pricing tier.
 *
 * `createBooking` already drops client-supplied owner fields for anyone who cannot
 * manage others' bookings, so a customer always books for themselves. The pricing
 * tier had been left out of that list, and `resolveOwnerCategory` honours an
 * explicit `customerCategory` ahead of any Keycloak lookup — so a customer could
 * post `INTERNAL_CUSTOMERS` on their own booking and be billed at the internal
 * rate. That is precisely the leak `pricing-visibility.ts` exists to prevent, and
 * unlike a job a booking has no staff override to correct the snapshot afterwards.
 *
 * Staff keep the override: booking for a customer whose Keycloak group has not
 * been set yet is its legitimate use.
 */

const staff = { sub: 'sub-staff', email: 'tech@bu.edu', realm_access: { roles: ['damplab-staff'] } } as unknown as User;
/**
 * Since 2026-10-05 a walk-up booking is lab staff's alone (`jobs:view-all`), so
 * the caller who cannot name a tier is now a technician: staff, but without the
 * Administrator's `inventory:write`. Named `customer` because the rule it pins —
 * book for yourself, at your own tier — is the one a customer was held to.
 */
const customer = { sub: 'sub-customer', email: 'cara@lab.org', realm_access: { roles: ['technician'] } } as unknown as User;
const client = { sub: 'sub-client', email: 'cara@lab.org', realm_access: { roles: ['client-unassisted-equipment-user'] } } as unknown as User;

function harness(): { resolver: BookingResolver; seen: any[] } {
  const seen: any[] = [];
  const bookingService: any = {
    create: async (input: any, actor: any): Promise<any> => {
      seen.push({ input, actor });
      return { id: 'booking-1' };
    }
  };
  return { resolver: new BookingResolver(bookingService, undefined as any, undefined as any), seen };
}

const input = (overrides: Record<string, unknown> = {}): any => ({
  inventoryItemId: 'item-1',
  start: new Date('2026-09-08T10:00:00Z'),
  end: new Date('2026-09-08T11:00:00Z'),
  ...overrides
});

describe('createBooking and the pricing tier', () => {
  it('drops a customer-supplied category so the tier is resolved, not claimed', async () => {
    const { resolver, seen } = harness();

    await resolver.createBooking(input({ customerCategory: 'INTERNAL_CUSTOMERS' }), customer);

    expect(seen[0].input.customerCategory).toBeUndefined();
  });

  it('drops it whichever tier is claimed, including a cheaper one for someone else to notice', async () => {
    const { resolver, seen } = harness();

    await resolver.createBooking(input({ customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC' }), customer);

    expect(seen[0].input.customerCategory).toBeUndefined();
  });

  it('keeps the owner fields dropped alongside it', async () => {
    const { resolver, seen } = harness();

    await resolver.createBooking(
      input({ customerCategory: 'INTERNAL_CUSTOMERS', ownerSub: 'sub-someone-else', ownerEmail: 'rich@lab.org', ownerName: 'Someone Else', ownerInstitution: 'Elsewhere' }),
      customer
    );

    expect(seen[0].input).toMatchObject({
      customerCategory: undefined,
      ownerSub: undefined,
      ownerEmail: undefined,
      ownerName: undefined,
      ownerInstitution: undefined
    });
  });

  it('leaves a booking with no category alone — there is nothing to strip', async () => {
    const { resolver, seen } = harness();

    await resolver.createBooking(input(), customer);

    expect(seen[0].input.customerCategory).toBeUndefined();
    expect(seen[0].actor.sub).toBe('sub-customer');
  });

  it('honours it for staff, who book for customers whose group is not set yet', async () => {
    const { resolver, seen } = harness();

    await resolver.createBooking(input({ customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC', ownerSub: 'sub-customer' }), staff);

    expect(seen[0].input.customerCategory).toBe('EXTERNAL_CUSTOMER_ACADEMIC');
    expect(seen[0].input.ownerSub).toBe('sub-customer');
  });

  it('passes the caller’s own claims through, so booking for yourself needs no Admin API call', async () => {
    const { resolver, seen } = harness();

    await resolver.createBooking(input(), customer);

    expect(seen[0].actor).toMatchObject({ sub: 'sub-customer', realm_access: { roles: ['technician'] } });
  });
});

describe('createBooking is for lab staff only', () => {
  it('refuses a client — equipment users book through a job — before anything is written', async () => {
    const { resolver, seen } = harness();
    await expect(resolver.createBooking(input(), client)).rejects.toThrow(/booked through a job/);
    await expect(resolver.createBooking(input(), { sub: 'x', email: 'x@x.org', realm_access: { roles: [] } } as unknown as User)).rejects.toThrow(/booked through a job/);
    expect(seen).toEqual([]);
  });
});
