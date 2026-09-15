import { callerMayAccessJob } from './job-access';

describe('callerMayAccessJob', () => {
  const owner = { sub: 'customer-1', email: 'owner@example.org' };
  const job = { sub: 'customer-1', clientEmail: 'named-client@bu.edu' };

  it('admits the submitter by sub', () => {
    expect(callerMayAccessJob(job, owner, false)).toBe(true);
  });

  it('admits the client named on a staff-submitted job, ignoring case and padding', () => {
    expect(callerMayAccessJob(job, { sub: 'client-7', email: '  Named-Client@BU.edu ' }, false)).toBe(true);
  });

  it('admits anyone flagged as seeing every job, whatever the job says', () => {
    expect(callerMayAccessJob({ sub: 'someone-else' }, { sub: 'tech-1', email: 'tech@example.org' }, true)).toBe(true);
    expect(callerMayAccessJob({}, { sub: 'tech-1' }, true)).toBe(true);
  });

  it('refuses a stranger', () => {
    expect(callerMayAccessJob(job, { sub: 'stranger', email: 'stranger@example.org' }, false)).toBe(false);
  });

  it('refuses a stranger with no email at all', () => {
    expect(callerMayAccessJob(job, { sub: 'stranger' }, false)).toBe(false);
  });

  it('does not match a job with no client email against a user with no email', () => {
    expect(callerMayAccessJob({ sub: 'someone-else' }, { sub: 'stranger' }, false)).toBe(false);
  });

  it('refuses a missing job even to someone who sees every job', () => {
    expect(callerMayAccessJob(null, { sub: 'tech-1' }, true)).toBe(false);
    expect(callerMayAccessJob(null, owner, false)).toBe(false);
  });
});
