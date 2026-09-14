import { ForbiddenException } from '@nestjs/common';
import { Role } from '../auth/roles/roles.enum';
import { User } from '../auth/user.interface';
import { assertCanReadSow, canReadSow, invoiceBlockedReason, isJobOwner } from './sow-access';

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

describe('invoiceBlockedReason', () => {
  const versioned = { hasAnyVersion: true, everCountersigned: false };
  const countersignedBefore = { hasAnyVersion: true, everCountersigned: true };
  const legacy = { hasAnyVersion: false, everCountersigned: false };

  it('lets a countersigned SOW through, which is the only thing an invoice bills', () => {
    expect(invoiceBlockedReason('FINAL', versioned)).toBeNull();
    expect(invoiceBlockedReason('FINAL', legacy)).toBeNull();
  });

  it('refuses SENT and SIGNED, which are agreement by at most one party', () => {
    expect(invoiceBlockedReason('SENT', versioned)).toMatch(/not been countersigned yet/i);
    expect(invoiceBlockedReason('SIGNED', versioned)).toMatch(/not been countersigned yet/i);
  });

  it('refuses a cancelled SOW in its own words', () => {
    expect(invoiceBlockedReason('CANCELLED', countersignedBefore)).toMatch(/cancelled/i);
  });

  /**
   * The distinction the whole `history` argument exists for. Withdrawing zeroes
   * `activeVersionNumber` exactly as never having issued anything leaves it, so
   * without this a staff member who countersigned a SOW last week is told they
   * never did — and concludes the software is broken.
   */
  it('tells a withdrawn SOW apart from one never countersigned', () => {
    expect(invoiceBlockedReason(undefined, countersignedBefore)).toMatch(/withdrawn/i);
    expect(invoiceBlockedReason(undefined, versioned)).not.toMatch(/withdrawn/i);
    expect(invoiceBlockedReason(undefined, versioned)).toMatch(/not been sent to the customer or countersigned/i);
  });

  it('points a pre-versioning SOW at the migration rather than at a workflow it cannot complete', () => {
    // Staff cannot fix these by hand: the editor holds no fields when
    // currentVersion is null. See test/integration/legacy-unversioned-sow.spec.ts.
    expect(invoiceBlockedReason(undefined, legacy)).toMatch(/migration/i);
  });

  it('treats a DRAFT above nothing as never issued, not as a fifth case', () => {
    expect(invoiceBlockedReason('DRAFT', versioned)).toMatch(/not been sent to the customer or countersigned/i);
  });
});
