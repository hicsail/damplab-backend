import { ConfigService } from '@nestjs/config';
import { AccessTier, ACCESS_GROUP_NAMES, LESSER_TIERS, TIER_GROUP, TIER_ROLE, deriveAccessTier, deriveAccessTierFromGroups, isAccessGroupName } from './access-tiers';
import { Role } from './roles.enum';
import { CUSTOMER_PRICING_GROUP_NAMES } from '../../pricing/pricing-groups';
import { KeycloakService } from '../../keycloak/keycloak.service';

describe('access tiers — the table', () => {
  it('never overlaps the pricing groups', () => {
    // The load-bearing invariant of this whole feature. If a name appeared on both
    // lists, setUserAccessTier would strip a pricing group and silently reprice a
    // customer -- a billing bug with no visible symptom until an invoice is wrong.
    for (const name of ACCESS_GROUP_NAMES) {
      expect(CUSTOMER_PRICING_GROUP_NAMES).not.toContain(name);
    }
  });

  it('maps every tier but CLIENT to a group and a role', () => {
    for (const tier of [AccessTier.ADMINISTRATOR, AccessTier.TECHNICIAN, AccessTier.EQUIPMENT_USER]) {
      expect(TIER_GROUP[tier]).toBeTruthy();
      expect(TIER_ROLE[tier]).toBeTruthy();
    }
    // CLIENT is the baseline, not a grant: no group to join, no role to hold.
    expect(TIER_GROUP[AccessTier.CLIENT]).toBeNull();
    expect(TIER_ROLE[AccessTier.CLIENT]).toBeNull();
  });

  it('keeps the equipment user group plural and its role singular', () => {
    // The realm genuinely spells these differently. Writing the role name as a group
    // would 404; reading the group name off a token would never match.
    expect(TIER_GROUP[AccessTier.EQUIPMENT_USER]).toBe('client-unassisted-equipment-users');
    expect(TIER_ROLE[AccessTier.EQUIPMENT_USER]).toBe(Role.ClientUnassistedEquipmentUser);
  });

  it('offers exactly the three lesser tiers for preview, never Administrator', () => {
    expect(LESSER_TIERS).toEqual([AccessTier.TECHNICIAN, AccessTier.EQUIPMENT_USER, AccessTier.CLIENT]);
    expect(LESSER_TIERS).not.toContain(AccessTier.ADMINISTRATOR);
  });

  it('treats only the three access groups as removable', () => {
    expect(isAccessGroupName('damplab-staff')).toBe(true);
    expect(isAccessGroupName('technician')).toBe(true);
    expect(isAccessGroupName('client-unassisted-equipment-users')).toBe(true);
    expect(isAccessGroupName('internal-customers')).toBe(false);
    expect(isAccessGroupName('external-customer-market')).toBe(false);
    expect(isAccessGroupName(undefined)).toBe(false);
  });
});

describe('deriveAccessTier', () => {
  it('falls to CLIENT when nothing is carried', () => {
    expect(deriveAccessTier([])).toBe(AccessTier.CLIENT);
    // A pricing group is not an access grant. This is the whole point of two axes.
    expect(deriveAccessTier(['internal-customers'])).toBe(AccessTier.CLIENT);
  });

  it('reads either spelling — group or realm role', () => {
    expect(deriveAccessTier(['technician'])).toBe(AccessTier.TECHNICIAN);
    expect(deriveAccessTier(['client-unassisted-equipment-users'])).toBe(AccessTier.EQUIPMENT_USER);
    expect(deriveAccessTier(['client-unassisted-equipment-user'])).toBe(AccessTier.EQUIPMENT_USER);
  });

  it('tolerates group paths', () => {
    expect(deriveAccessTierFromGroups([{ name: 'technician', path: '/technician' }])).toBe(AccessTier.TECHNICIAN);
  });

  it('reports the highest tier held, because permissions union', () => {
    // Someone holding both resolves to ALL_PERMISSIONS, so calling them a Technician
    // would misdescribe what they can actually do.
    expect(deriveAccessTier(['technician', 'damplab-staff'])).toBe(AccessTier.ADMINISTRATOR);
    expect(deriveAccessTier(['client-unassisted-equipment-users', 'technician'])).toBe(AccessTier.TECHNICIAN);
  });
});

describe('KeycloakService.setUserAccessTier', () => {
  /**
   * Every network call is stubbed. Nothing in this file may reach a real Keycloak:
   * the realm is shared with production, so a test that wrote to it would move a real
   * person between groups.
   */
  function serviceWith(authDisabled: boolean): { service: KeycloakService; removed: string[]; added: string[] } {
    const config = {
      get: (key: string) => (key === 'auth.disable' ? authDisabled : { serverUrl: 'https://kc.invalid', realm: 'damplab', clientId: 'c', clientSecret: 's' })
    } as unknown as ConfigService;
    const service = new KeycloakService(config);
    const removed: string[] = [];
    const added: string[] = [];

    // The user is an administrator who is also an internal customer -- both axes
    // populated, which is the case a careless implementation breaks.
    jest.spyOn(service, 'getUserGroups').mockResolvedValue([
      { id: 'g-staff', name: 'damplab-staff' },
      { id: 'g-internal', name: 'internal-customers' }
    ] as any);
    jest.spyOn(service, 'removeUserFromGroup').mockImplementation(async (_u, groupId) => {
      removed.push(groupId);
    });
    jest.spyOn(service, 'addUserToGroup').mockImplementation(async (_u, groupId) => {
      added.push(groupId);
    });
    jest.spyOn(service as any, 'findGroupByName').mockImplementation(async (name: unknown) => ({ id: `g-${name}`, name }));

    return { service, removed, added };
  }

  it('swaps the access group and leaves the pricing group alone', async () => {
    const { service, removed, added } = serviceWith(false);
    await service.setUserAccessTier('u1', AccessTier.TECHNICIAN);
    expect(removed).toEqual(['g-staff']);
    expect(removed).not.toContain('g-internal');
    expect(added).toEqual(['g-technician']);
  });

  it('makes someone a Client by removing access groups and adding none', async () => {
    const { service, removed, added } = serviceWith(false);
    await service.setUserAccessTier('u1', AccessTier.CLIENT);
    expect(removed).toEqual(['g-staff']);
    expect(added).toEqual([]);
  });

  it('refuses to write anything while the auth bypass is on', async () => {
    // DISABLE_AUTH makes unauthenticated localhost callers administrators, and this
    // realm is shared with production. Reads stay allowed; writes do not.
    const { service, removed, added } = serviceWith(true);
    await expect(service.setUserAccessTier('u1', AccessTier.TECHNICIAN)).rejects.toThrow(/DISABLE_AUTH/);
    expect(removed).toEqual([]);
    expect(added).toEqual([]);
  });

  it('refuses pricing writes under the bypass too', async () => {
    const { service } = serviceWith(true);
    await expect(service.setUserCustomerCategory('u1', null)).rejects.toThrow(/DISABLE_AUTH/);
  });
});
