import { HomologyScreeningStatus } from '../job/job.model';
import {
  parseHomologyMode,
  homologyStatusFromAclidRegulatory,
  homologyStatusFromAclidScreen,
  customerStatusFromAclid,
  customerVerificationState,
  rollupHomologyStatuses,
  isAclidLengthEligible
} from './aclid-status.util';

describe('parseHomologyMode', () => {
  it('defaults to aclid when Aclid is configured and the env is unset or unknown', () => {
    expect(parseHomologyMode(undefined, true)).toBe('aclid');
    expect(parseHomologyMode('nope', true)).toBe('aclid');
  });

  it('defaults to securedna when Aclid is not configured', () => {
    expect(parseHomologyMode(undefined, false)).toBe('securedna');
    expect(parseHomologyMode('aclid', false)).toBe('securedna');
    expect(parseHomologyMode('both', false)).toBe('securedna');
  });

  it('honours securedna and both when Aclid is configured', () => {
    expect(parseHomologyMode('securedna', true)).toBe('securedna');
    expect(parseHomologyMode('BOTH', true)).toBe('both');
  });
});

describe('homologyStatusFromAclidRegulatory', () => {
  it('maps controlled to Failed and not_controlled to Passed', () => {
    expect(homologyStatusFromAclidRegulatory('controlled')).toBe(HomologyScreeningStatus.FAILED);
    expect(homologyStatusFromAclidRegulatory('not_controlled')).toBe(HomologyScreeningStatus.PASSED);
  });

  it('is Unavailable when Aclid has not given a regulatory status', () => {
    expect(homologyStatusFromAclidRegulatory(null)).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(homologyStatusFromAclidRegulatory(undefined)).toBe(HomologyScreeningStatus.UNAVAILABLE);
  });
});

describe('homologyStatusFromAclidScreen', () => {
  it('passes a succeeded screen that has no regulatory status', () => {
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: null })).toBe(HomologyScreeningStatus.PASSED);
  });

  it('still fails a succeeded screen that is controlled', () => {
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: 'controlled' })).toBe(HomologyScreeningStatus.FAILED);
  });

  it('does not treat a failed screen with no regulatory status as a pass', () => {
    expect(homologyStatusFromAclidScreen({ status: 'failed', regulatoryStatus: null })).toBe(HomologyScreeningStatus.UNAVAILABLE);
  });
});

describe('customerVerificationState', () => {
  it('is unavailable without a screen', () => {
    expect(customerVerificationState(null)).toBe('unavailable');
    expect(customerVerificationState({ verificationStatus: 'submitted' })).toBe('unavailable');
  });

  it('treats a finished verification as submitted without naming the decision', () => {
    expect(customerVerificationState({ screenId: 's', verificationStatus: 'submitted' })).toBe('submitted');
    expect(customerVerificationState({ screenId: 's', verificationCompletedAt: '2026-09-02T00:00:00Z' })).toBe('submitted');
    expect(customerVerificationState({ screenId: 's', decisionStatus: 'approved' })).toBe('submitted');
    expect(customerVerificationState({ screenId: 's', decisionStatus: 'rejected' })).toBe('submitted');
  });

  it('keeps a partial or missing verification as not submitted, and not_required on its own', () => {
    expect(customerVerificationState({ screenId: 's', verificationStatus: 'missing_verification' })).toBe('not_submitted');
    expect(customerVerificationState({ screenId: 's', verificationStatus: 'partially_submitted' })).toBe('not_submitted');
    expect(customerVerificationState({ screenId: 's' })).toBe('not_submitted');
    expect(customerVerificationState({ screenId: 's', verificationStatus: 'not_required' })).toBe('not_required');
  });
});

describe('customerStatusFromAclid', () => {
  it('is Unavailable without a screen id', () => {
    expect(customerStatusFromAclid({})).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(customerStatusFromAclid({ decisionStatus: 'approved' })).toBe(HomologyScreeningStatus.UNAVAILABLE);
  });

  it('maps decision_status and not_required', () => {
    expect(customerStatusFromAclid({ screenId: 's1', decisionStatus: 'approved' })).toBe(HomologyScreeningStatus.PASSED);
    expect(customerStatusFromAclid({ screenId: 's1', decisionStatus: 'rejected' })).toBe(HomologyScreeningStatus.FAILED);
    expect(customerStatusFromAclid({ screenId: 's1', verificationStatus: 'not_required' })).toBe(HomologyScreeningStatus.PASSED);
  });

  it('is In Progress while awaiting, escalated, partial, or missing', () => {
    for (const verificationStatus of ['partially_submitted', 'missing_verification', 'submitted']) {
      expect(customerStatusFromAclid({ screenId: 's1', verificationStatus })).toBe(HomologyScreeningStatus.IN_PROGRESS);
    }
    expect(customerStatusFromAclid({ screenId: 's1', decisionStatus: 'awaiting' })).toBe(HomologyScreeningStatus.IN_PROGRESS);
    expect(customerStatusFromAclid({ screenId: 's1', decisionStatus: 'escalated' })).toBe(HomologyScreeningStatus.IN_PROGRESS);
  });
});

describe('rollupHomologyStatuses', () => {
  it('fails if either provider failed, prefers in-progress over passed, ignores unavailable', () => {
    expect(rollupHomologyStatuses([HomologyScreeningStatus.PASSED, HomologyScreeningStatus.FAILED])).toBe(HomologyScreeningStatus.FAILED);
    expect(rollupHomologyStatuses([HomologyScreeningStatus.PASSED, HomologyScreeningStatus.IN_PROGRESS])).toBe(HomologyScreeningStatus.IN_PROGRESS);
    expect(rollupHomologyStatuses([HomologyScreeningStatus.PASSED, HomologyScreeningStatus.UNAVAILABLE])).toBe(HomologyScreeningStatus.PASSED);
    expect(rollupHomologyStatuses([HomologyScreeningStatus.UNAVAILABLE])).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(rollupHomologyStatuses([])).toBe(HomologyScreeningStatus.UNAVAILABLE);
  });
});

describe('isAclidLengthEligible', () => {
  it('requires 30 nucleotides after whitespace stripping', () => {
    expect(isAclidLengthEligible('ATGC'.repeat(7))).toBe(false); // 28
    expect(isAclidLengthEligible('ATGC'.repeat(8))).toBe(true); // 32
    expect(isAclidLengthEligible(` ${'A'.repeat(30)} \n`)).toBe(true);
  });
});
