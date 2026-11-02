import { ForbiddenException } from '@nestjs/common';
import { assertShowsBiosecurity, callerShowsBiosecurity } from './biosecurity-gate';

const user: any = { sub: 'u1', email: 'a@bu.edu', preferred_username: 'a', realm_access: { roles: [] } };

describe('biosecurity gate', () => {
  it('reads the account flag from Keycloak', async () => {
    expect(await callerShowsBiosecurity({ userShowsBiosecurity: jest.fn(async () => false) }, user)).toBe(false);
    expect(await callerShowsBiosecurity({ userShowsBiosecurity: jest.fn(async () => true) }, user)).toBe(true);
  });

  it('treats a harness with no Keycloak method, or no sub, as shown', async () => {
    expect(await callerShowsBiosecurity({} as any, user)).toBe(true);
    expect(await callerShowsBiosecurity(undefined, user)).toBe(true);
    expect(await callerShowsBiosecurity({ userShowsBiosecurity: jest.fn(async () => false) }, { ...user, sub: '' })).toBe(true);
  });

  it('assertShowsBiosecurity refuses with FORBIDDEN', async () => {
    await expect(assertShowsBiosecurity({ userShowsBiosecurity: jest.fn(async () => false) }, user)).rejects.toThrow(new ForbiddenException('Biosecurity is not enabled for this account'));
  });
});
