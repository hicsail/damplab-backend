import { BadRequestException } from '@nestjs/common';
import { isJobMember, isValidEmail, jobMemberEmails, jobMembersFilter, jobPrimaryEmail, normalizeMemberEmailList } from './job-membership';

describe('jobPrimaryEmail', () => {
  it('is the client email on a staff-submitted job', () => {
    expect(jobPrimaryEmail({ email: 'tech@bu.edu', clientEmail: ' Client@BU.edu ' })).toBe('client@bu.edu');
  });
  it('falls back to the submitter email', () => {
    expect(jobPrimaryEmail({ email: 'Owner@X.org' })).toBe('owner@x.org');
  });
  it('treats a blank client email as unset', () => {
    expect(jobPrimaryEmail({ email: 'owner@x.org', clientEmail: '  ' })).toBe('owner@x.org');
  });
  it('is undefined for a missing job', () => {
    expect(jobPrimaryEmail(null)).toBeUndefined();
  });
});

describe('jobMemberEmails', () => {
  it('normalizes, dedupes and never lists the primary', () => {
    expect(jobMemberEmails({ email: 'owner@x.org', memberEmails: ['A@x.org', 'a@x.org ', 'OWNER@x.org', 'b@x.org'] })).toEqual(['a@x.org', 'b@x.org']);
  });
  it('is empty for a legacy job with no field', () => {
    expect(jobMemberEmails({ email: 'owner@x.org' })).toEqual([]);
  });
});

describe('isJobMember', () => {
  const job = { sub: 'staff-sub', email: 'tech@bu.edu', clientEmail: 'client@bu.edu', memberEmails: ['member@x.org'] };

  it('admits the submitter by sub', () => {
    expect(isJobMember(job, { sub: 'staff-sub' })).toBe(true);
  });
  it('admits the primary client by email, ignoring case and padding', () => {
    expect(isJobMember(job, { sub: 'other', email: '  Client@BU.edu ' })).toBe(true);
  });
  it('admits a member by email, ignoring case', () => {
    expect(isJobMember(job, { sub: 'other', email: 'MEMBER@x.org' })).toBe(true);
  });
  it('admits the submitter email on an ordinary job (no clientEmail)', () => {
    expect(isJobMember({ sub: 'a', email: 'owner@x.org' }, { sub: 'b', email: 'Owner@x.org' })).toBe(true);
  });
  it('refuses a stranger', () => {
    expect(isJobMember(job, { sub: 'stranger', email: 'stranger@x.org' })).toBe(false);
  });
  it('does not match empty identifiers on both sides', () => {
    expect(isJobMember({ sub: '', email: '' }, { sub: '', email: '' })).toBe(false);
    expect(isJobMember({}, {})).toBe(false);
  });
  it('refuses a missing job or user', () => {
    expect(isJobMember(null, { sub: 'staff-sub' })).toBe(false);
    expect(isJobMember(job, null)).toBe(false);
  });
  it('never admits the staff member recorded as submitter (B28)', () => {
    const clientOwned: any = { sub: 'client-kc', email: 'client@bu.edu', clientEmail: 'client@bu.edu', submittedBy: { sub: 'admin-1', email: 'tech@bu.edu', name: 'Tech' } };
    expect(isJobMember(clientOwned, { sub: 'admin-1', email: 'tech@bu.edu' })).toBe(false);
    expect(isJobMember(clientOwned, { sub: 'client-kc' })).toBe(true);
  });
});

describe('jobMembersFilter', () => {
  it('is sub-only without an email to match', () => {
    expect(jobMembersFilter('s1', undefined)).toEqual({ sub: 's1' });
    expect(jobMembersFilter('s1', '   ')).toEqual({ sub: 's1' });
  });
  it('matches sub, the effective primary email, or a member email', () => {
    const filter: any = jobMembersFilter('s1', ' Me@X.org ');
    expect(filter.$or).toHaveLength(3);
    expect(filter.$or[0]).toEqual({ sub: 's1' });
    expect(filter.$or[1].$expr.$eq[1]).toBe('me@x.org');
    expect(filter.$or[2]).toEqual({ memberEmails: 'me@x.org' });
  });
});

describe('isValidEmail', () => {
  it.each([
    ['a@b.org', true],
    [' A@B.org ', true],
    ['nope', false],
    ['a@b', false],
    ['', false],
    [undefined, false]
  ])('%p -> %p', (value, expected) => {
    expect(isValidEmail(value as any)).toBe(expected);
  });
});

describe('normalizeMemberEmailList', () => {
  it('normalizes, dedupes, drops blanks and the primary', () => {
    expect(normalizeMemberEmailList([' Friend@X.org', 'friend@x.org', '', 'Owner@x.org', 'b@y.org'], 'owner@x.org')).toEqual(['friend@x.org', 'b@y.org']);
  });
  it('rejects a malformed address', () => {
    expect(() => normalizeMemberEmailList(['not-an-email'], 'owner@x.org')).toThrow(BadRequestException);
  });
  it('is empty for no input', () => {
    expect(normalizeMemberEmailList(undefined, 'owner@x.org')).toEqual([]);
  });
});
