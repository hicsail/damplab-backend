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

describe('resolveClientAccountByEmail', () => {
  function byEmail(opts: { configured?: boolean; user?: { id: string; username?: string; email?: string } | null; groups?: unknown[]; throws?: boolean } = {}): { instance: any; warnings: string[] } {
    const warnings: string[] = [];
    const instance = Object.create(KeycloakService.prototype) as any;
    instance.logger = { warn: (msg: string): void => void warnings.push(msg) };
    instance.isConfigured = (): boolean => opts.configured !== false;
    instance.findUserByExactEmail = async (): Promise<unknown> => {
      if (opts.throws) throw new Error('keycloak unreachable');
      return opts.user === undefined ? { id: 'kc-1', username: 'cara', email: 'client@bu.edu' } : opts.user;
    };
    instance.getUserGroups = async (): Promise<unknown[]> => opts.groups ?? [];
    return { instance, warnings };
  }

  it("returns the named client's sub, username and pricing group — never the submitter's", async () => {
    const { instance } = byEmail({ groups: ACADEMIC_GROUP });
    expect(await instance.resolveClientAccountByEmail('client@bu.edu')).toEqual({ sub: 'kc-1', username: 'cara', customerCategory: CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC });
  });

  it('keeps the account ids when the client has no pricing group', async () => {
    const { instance, warnings } = byEmail({ groups: [] });
    expect(await instance.resolveClientAccountByEmail('client@bu.edu')).toEqual({ sub: 'kc-1', username: 'cara', customerCategory: undefined });
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('is empty, with a warning, when no account has that email', async () => {
    const { instance, warnings } = byEmail({ user: null });
    expect(await instance.resolveClientAccountByEmail('nobody@bu.edu')).toEqual({});
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('is empty, with a warning, when the lookup fails', async () => {
    const { instance, warnings } = byEmail({ throws: true });
    await expect(instance.resolveClientAccountByEmail('client@bu.edu')).resolves.toEqual({});
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('is empty when the Admin API is not configured', async () => {
    const { instance } = byEmail({ configured: false });
    expect(await instance.resolveClientAccountByEmail('client@bu.edu')).toEqual({});
  });
});

describe('findUserByExactEmail', () => {
  it('asks for an exact match and keeps only a case-insensitive equal address', async () => {
    const instance = Object.create(KeycloakService.prototype) as any;
    instance.realm = 'damplab';
    const paths: string[] = [];
    instance.fetchWithToken = async (path: string): Promise<any> => {
      paths.push(path);
      return {
        ok: true,
        json: async () => [
          { id: 'a', email: 'client@bu.edu.evil' },
          { id: 'b', username: 'cara', email: 'Client@BU.edu' }
        ]
      };
    };
    const found = await instance.findUserByExactEmail(' Client@BU.edu ');
    expect(paths[0]).toBe('/admin/realms/damplab/users?email=client%40bu.edu&exact=true');
    expect(found).toMatchObject({ id: 'b', username: 'cara' });
  });

  it('throws on a failed request so the caller can log it', async () => {
    const instance = Object.create(KeycloakService.prototype) as any;
    instance.realm = 'damplab';
    instance.fetchWithToken = async (): Promise<any> => ({ ok: false, status: 500, text: async () => 'boom' });
    await expect(instance.findUserByExactEmail('client@bu.edu')).rejects.toThrow(/500/);
  });
});
