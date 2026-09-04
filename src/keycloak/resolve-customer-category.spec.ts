import { KeycloakService } from './keycloak.service';
import { CustomerCategory } from '../job/job.model';

/**
 * Resolving a user's pricing category when the token does not carry their groups.
 *
 * Pricing is decided by Keycloak group membership and the pricing groups have no
 * realm roles — that is the documented design (docs/access-matrix.md). But group
 * memberships only appear in a token when the realm's client carries a Group
 * Membership mapper, which nothing in this repository configures or can check.
 * Without this fallback an academic customer submits a job, derives to
 * `undefined`, and is billed the catalogue's fallback price on every document.
 */
function service(opts: { configured?: boolean; groups?: unknown[]; throws?: boolean } = {}): KeycloakService {
  const instance = Object.create(KeycloakService.prototype) as any;
  instance.logger = { warn: (): void => undefined };
  instance.isConfigured = (): boolean => opts.configured !== false;
  instance.getUserGroups = async (): Promise<unknown[]> => {
    if (opts.throws) throw new Error('keycloak unreachable');
    return opts.groups ?? [];
  };
  return instance as KeycloakService;
}

const ACADEMIC_GROUP = [{ name: 'external-customer-academic', path: '/external-customer-academic' }];

describe('resolveCustomerCategoryForUser', () => {
  it('reads the group from the Admin API when the token carries no groups claim', async () => {
    // The reported bug: in the group, no associated role, no groups claim.
    const category = await service({ groups: ACADEMIC_GROUP }).resolveCustomerCategoryForUser({ sub: 'user-1', realm_access: { roles: [] } });
    expect(category).toBe(CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC);
  });

  it('does not need a realm role for the pricing group', async () => {
    // Access roles and pricing groups are separate axes; a pricing group having
    // no role is the documented arrangement, not a misconfiguration.
    const category = await service({ groups: ACADEMIC_GROUP }).resolveCustomerCategoryForUser({
      sub: 'user-1',
      realm_access: { roles: ['damplab-staff'] }
    });
    expect(category).toBe(CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC);
  });

  it('prefers the token when it does carry the group, without calling Keycloak', async () => {
    let called = false;
    const instance = service({ groups: ACADEMIC_GROUP }) as any;
    instance.getUserGroups = async (): Promise<unknown[]> => {
      called = true;
      return [];
    };
    const category = await instance.resolveCustomerCategoryForUser({ sub: 'user-1', groups: ['/external-customer-market'] });
    expect(category).toBe(CustomerCategory.EXTERNAL_CUSTOMER_MARKET);
    expect(called).toBe(false);
  });

  it('still honours a role-based claim, so nothing that worked before regresses', async () => {
    const category = await service().resolveCustomerCategoryForUser({ sub: 'user-1', realm_access: { roles: ['internal-customer'] } });
    expect(category).toBe(CustomerCategory.INTERNAL_CUSTOMERS);
  });

  it('returns undefined rather than guessing when the user is in no pricing group', async () => {
    expect(await service({ groups: [] }).resolveCustomerCategoryForUser({ sub: 'user-1' })).toBeUndefined();
  });

  it('returns undefined when the Admin API is not configured, as in local development', async () => {
    expect(await service({ configured: false }).resolveCustomerCategoryForUser({ sub: 'user-1' })).toBeUndefined();
  });

  it('never blocks a submission when Keycloak is unreachable', async () => {
    await expect(service({ throws: true }).resolveCustomerCategoryForUser({ sub: 'user-1' })).resolves.toBeUndefined();
  });

  it('tolerates a missing user without calling out', async () => {
    expect(await service().resolveCustomerCategoryForUser(undefined)).toBeUndefined();
  });
});
