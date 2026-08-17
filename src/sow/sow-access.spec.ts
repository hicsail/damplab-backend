import { ForbiddenException } from '@nestjs/common';
import { Role } from '../auth/roles/roles.enum';
import { User } from '../auth/user.interface';
import { assertCanReadSow, canReadSow, isJobOwner } from './sow-access';

function user(overrides: Partial<User> = {}): User {
  return {
    preferred_username: 'someone',
    sub: 'sub-stranger',
    email: 'stranger@example.com',
    realm_access: { roles: [] },
    ...overrides
  } as User;
}

const staff = user({ sub: 'sub-staff', email: 'tech@bu.edu', realm_access: { roles: [Role.DamplabStaff] } });
const owner = user({ sub: 'sub-owner', email: 'client@lab.org' });
const job = { sub: 'sub-owner', email: 'client@lab.org' };

describe('SOW read access', () => {
  it('allows staff to read any SOW', () => {
    expect(canReadSow(job, staff)).toBe(true);
  });

  it('allows the job owner, matching on sub', () => {
    expect(canReadSow(job, user({ sub: 'sub-owner', email: 'changed@elsewhere.com' }))).toBe(true);
  });

  it('allows the job owner, matching on email', () => {
    expect(canReadSow(job, user({ sub: 'different-sub', email: 'client@lab.org' }))).toBe(true);
  });

  it('denies an unrelated authenticated customer', () => {
    expect(canReadSow(job, user())).toBe(false);
    expect(() => assertCanReadSow(job, user())).toThrow(ForbiddenException);
  });

  it('denies when there is no user at all', () => {
    expect(canReadSow(job, undefined)).toBe(false);
  });

  it('allows read-only API-key callers, which carry no roles and match no owner', () => {
    // AuthRolesGuard has already verified the key and rejected any mutation.
    const apiKeyCaller = user({ sub: 'apikey:abc', realm_access: { roles: [] }, apiKey: true });
    expect(canReadSow(job, apiKeyCaller)).toBe(true);
  });

  it('does not treat missing identifiers on both sides as a match', () => {
    expect(isJobOwner({}, user({ sub: undefined as any, email: undefined as any }))).toBe(false);
    expect(isJobOwner({ sub: '', email: '' }, user({ sub: '', email: '' }))).toBe(false);
  });

  it('denies when the job cannot be found', () => {
    expect(canReadSow(null, owner)).toBe(false);
    // ...but staff still get through, so a dangling jobId is not a lockout for them.
    expect(canReadSow(null, staff)).toBe(true);
  });
});
