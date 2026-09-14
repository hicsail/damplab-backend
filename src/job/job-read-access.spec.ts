import { ForbiddenException } from '@nestjs/common';
import { assertMayReadJobFinancials, mayReadJobFinancials } from './job-read-access';
import { User } from '../auth/user.interface';

const job = { sub: 'creator-sub', clientEmail: 'Client@BU.edu' };
const user = (over: Partial<User> = {}): User => ({ sub: 'nobody', email: 'nobody@bu.edu', realm_access: { roles: [] }, ...over } as User);

describe('mayReadJobFinancials', () => {
  it('lets staff holding jobs:view-all read any job', () => {
    expect(mayReadJobFinancials(job, user({ realm_access: { roles: ['damplab-staff'] } } as any))).toBe(true);
  });

  it('lets a technician read any job, because they hold jobs:view-all too', () => {
    expect(mayReadJobFinancials(job, user({ realm_access: { roles: ['technician'] } } as any))).toBe(true);
  });

  it("lets the job's creator read it", () => {
    expect(mayReadJobFinancials(job, user({ sub: 'creator-sub' }))).toBe(true);
  });

  it('lets the named client read it, ignoring case and padding', () => {
    expect(mayReadJobFinancials(job, user({ email: '  client@bu.edu ' }))).toBe(true);
  });

  it('refuses a stranger', () => {
    expect(mayReadJobFinancials(job, user())).toBe(false);
  });

  it('refuses when the job is missing, rather than treating absence as access', () => {
    expect(mayReadJobFinancials(null, user({ sub: 'creator-sub' }))).toBe(false);
  });

  it('does not admit a job with no client email to every user without one', () => {
    expect(mayReadJobFinancials({ sub: 'creator-sub' }, user({ email: undefined }))).toBe(false);
  });
});

describe('assertMayReadJobFinancials', () => {
  it('throws a Forbidden with a message that does not confirm the job exists', () => {
    expect(() => assertMayReadJobFinancials(job, user())).toThrow(ForbiddenException);
    expect(() => assertMayReadJobFinancials(job, user())).toThrow('You do not have permission to view billing for this job.');
  });

  it('returns quietly for someone who may read it', () => {
    expect(() => assertMayReadJobFinancials(job, user({ sub: 'creator-sub' }))).not.toThrow();
  });
});
