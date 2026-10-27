import { CustomerManagementResolver, CustomerManagementUserListCategory, WHOLE_LIST_PAGE_SIZE } from './customer-management.resolver';

const rowsOf = (n: number, over: (i: number) => any = (): object => ({})): any[] => Array.from({ length: n }, (_, i) => ({ id: `u-${i}`, username: `user${i}`, ...over(i) }));

function build(all: any[]): { resolver: CustomerManagementResolver; keycloak: any; profiles: any } {
  const page = jest.fn(async (first: number, max: number) => all.slice(first, first + max));
  const keycloak: any = {
    isConfigured: () => true,
    listAllUsersWithCustomerCategory: page,
    listLabStaffWithCustomerCategory: page,
    listUsersInGroupWithCustomerCategory: jest.fn(async (_group: string, first: number, max: number) => all.slice(first, first + max)),
    searchUsersWithCustomerCategory: jest.fn(async () => all.slice(0, 2))
  };
  const profiles: any = {
    findBySubs: jest.fn(async (subs: string[]) => new Map(subs.filter((s) => s === 'u-1').map((s) => [s, { userSub: s, canBookWithoutApproval: true, position: 'PI' }] as [string, any])))
  };
  return { resolver: new CustomerManagementResolver(keycloak, profiles), keycloak, profiles };
}

describe('listKeycloakUsersForCustomerManagement', () => {
  it('returns the whole category when no limit is given, paging Keycloak 100 at a time', async () => {
    const { resolver, keycloak } = build(rowsOf(230));
    const out = await resolver.listKeycloakUsersForCustomerManagement(CustomerManagementUserListCategory.ALL, 0, undefined);
    expect(out.items).toHaveLength(230);
    expect(out.hasNextPage).toBe(false);
    expect(keycloak.listAllUsersWithCustomerCategory.mock.calls).toEqual([
      [0, WHOLE_LIST_PAGE_SIZE],
      [100, WHOLE_LIST_PAGE_SIZE],
      [200, WHOLE_LIST_PAGE_SIZE]
    ]);
  });

  it('attaches profiles in one lookup, with defaults for users who have no record', async () => {
    const { resolver, profiles } = build(rowsOf(3));
    const out = await resolver.listKeycloakUsersForCustomerManagement(CustomerManagementUserListCategory.STAFF, 0, null as any);
    expect(profiles.findBySubs).toHaveBeenCalledTimes(1);
    expect(profiles.findBySubs).toHaveBeenCalledWith(['u-0', 'u-1', 'u-2']);
    expect(out.items[1].profile).toMatchObject({ userSub: 'u-1', canBookWithoutApproval: true, position: 'PI' });
    expect(out.items[0].profile).toMatchObject({ userSub: 'u-0', canBookWithoutApproval: false, position: null });
  });

  it('keeps paging the default-external group by the raw page, not the filtered count', async () => {
    // 150 members, only every third one a default external. The first raw page has 100 rows
    // but filters to 34: the loop must still ask for the second page.
    const { resolver, keycloak } = build(rowsOf(150, (i) => ({ isDefaultExternalCustomer: i % 3 === 0 })));
    const out = await resolver.listKeycloakUsersForCustomerManagement(CustomerManagementUserListCategory.EXTERNAL_CUSTOMER_DEFAULT, 0, undefined);
    expect(keycloak.listUsersInGroupWithCustomerCategory).toHaveBeenCalledTimes(2);
    expect(out.items).toHaveLength(50);
    expect(out.items.every((r: any) => r.isDefaultExternalCustomer)).toBe(true);
  });

  it('keeps today’s paging for an explicit limit (an older UI)', async () => {
    const { resolver, keycloak } = build(rowsOf(60));
    const out = await resolver.listKeycloakUsersForCustomerManagement(CustomerManagementUserListCategory.ALL, 25, 25);
    expect(keycloak.listAllUsersWithCustomerCategory).toHaveBeenCalledWith(25, 26);
    expect(out.items.map((r: any) => r.id)[0]).toBe('u-25');
    expect(out.items).toHaveLength(25);
    expect(out.hasNextPage).toBe(true);
    expect(out.items[0].profile).toBeDefined();
  });

  it('pages the default-external category from the filtered whole, so pages are full and hasNextPage is exact', async () => {
    // 300 members, every other one a default external: 150 qualify.
    const { resolver } = build(rowsOf(300, (i) => ({ isDefaultExternalCustomer: i % 2 === 0 })));
    const cat = CustomerManagementUserListCategory.EXTERNAL_CUSTOMER_DEFAULT;
    const first = await resolver.listKeycloakUsersForCustomerManagement(cat, 0, 100);
    expect(first.items).toHaveLength(100);
    expect(first.hasNextPage).toBe(true);
    const last = await resolver.listKeycloakUsersForCustomerManagement(cat, 100, 100);
    expect(last.items).toHaveLength(50);
    expect(last.hasNextPage).toBe(false);
    const exact = await resolver.listKeycloakUsersForCustomerManagement(cat, 50, 100);
    expect(exact.items).toHaveLength(100);
    expect(exact.hasNextPage).toBe(false);
  });
});

describe('searchKeycloakUsersForCustomerManagement', () => {
  it('attaches profiles to search results too', async () => {
    const { resolver, profiles } = build(rowsOf(5));
    const out = await resolver.searchKeycloakUsersForCustomerManagement('user', 25);
    expect(profiles.findBySubs).toHaveBeenCalledWith(['u-0', 'u-1']);
    expect(out[1].profile?.canBookWithoutApproval).toBe(true);
    expect(out[0].profile?.canBookWithoutApproval).toBe(false);
  });
});
