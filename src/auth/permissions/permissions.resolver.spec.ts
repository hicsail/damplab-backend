import { PermissionsResolver } from './permissions.resolver';

describe('PermissionsResolver', () => {
  it('myPermissions carries no showBiosecurity (behaviour 19)', async () => {
    const resolver = new PermissionsResolver({ resolveCustomerCategoryForUser: async () => undefined } as any);
    const user: any = { sub: 'u1', realm_access: { roles: ['damplab-staff'] } };
    expect(await resolver.myPermissions(user)).not.toHaveProperty('showBiosecurity');
  });
});
