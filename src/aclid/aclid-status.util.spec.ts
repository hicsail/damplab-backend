import { HomologyScreeningStatus } from '../job/job.model';
import { CustomerScreeningStatus } from '../job/screening-run.model';
import {
  parseHomologyMode,
  homologyStatusFromAclidRegulatory,
  aclidResultsUnread,
  homologyStatusFromAclidScreen,
  customerScreeningStatus,
  jobCustomerStatusFromLeg,
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
  // Shaped like a real `GET /v2/screens/{id}/details` body (one group, trimmed).
  const controlledGroup = {
    seq_a: {
      matches: [{ query: 'seq_a', sseqid: 'AJ564621.1', regulatory_status: 'controlled', findings: { us_select_agent: { reason_code: 'virus', regulatory_status: 'controlled' } } }],
      findings: { us_select_agent: { reason_code: 'virus', regulatory_status: 'controlled' } },
      regulatory_status: 'controlled'
    }
  };
  const clearGroup = { seq_a: { matches: [], findings: null, regulatory_status: 'not_controlled' } };

  it('fails a succeeded screen with an empty top level when one sequence is controlled', () => {
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: null }, { ...clearGroup, ...controlledGroup })).toBe(HomologyScreeningStatus.FAILED);
  });

  it('fails on a controlled match or finding inside a group that does not say so itself', () => {
    const match = { seq_a: { matches: [{ regulatory_status: 'controlled' }], regulatory_status: 'not_controlled' } };
    const finding = { seq_a: { matches: [], findings: { x: { regulatory_status: 'controlled' } }, regulatory_status: null } };
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: null }, match)).toBe(HomologyScreeningStatus.FAILED);
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: null }, finding)).toBe(HomologyScreeningStatus.FAILED);
  });

  it('passes a succeeded screen whose details are all not_controlled', () => {
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: null }, clearGroup)).toBe(HomologyScreeningStatus.PASSED);
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: 'not_controlled' }, clearGroup)).toBe(HomologyScreeningStatus.PASSED);
  });

  it('gives no verdict to a succeeded screen whose details were not read', () => {
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: null }, null)).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: null })).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: 'not_controlled' }, null)).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(aclidResultsUnread({ status: 'succeeded', regulatoryStatus: null }, null)).toBe(true);
  });

  it.each([
    ['an empty body', {}],
    ['a group with a null status', { seq_a: { matches: [], findings: null, regulatory_status: null } }],
    ['a group with no status', { seq_a: { matches: [] } }],
    ['a group with an unknown status', { seq_a: { matches: [], regulatory_status: 'maybe' } }],
    ['a clear group beside one with a null status', { ...clearGroup, seq_b: { matches: [], regulatory_status: null } }],
    ['a non-object group', { seq_a: 'x' }]
  ])('gives no verdict to %s', (_label, details) => {
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: null }, details)).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(aclidResultsUnread({ status: 'succeeded', regulatoryStatus: null }, details)).toBe(true);
  });

  it('gives no verdict to details that are not an object', () => {
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: null }, [] as any)).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: null }, 'ok' as any)).toBe(HomologyScreeningStatus.UNAVAILABLE);
  });

  it('fails one controlled group beside a not_controlled one, and passes one not_controlled group', () => {
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: null }, { ...clearGroup, ...{ seq_b: controlledGroup.seq_a } })).toBe(HomologyScreeningStatus.FAILED);
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: null }, clearGroup)).toBe(HomologyScreeningStatus.PASSED);
  });

  it('fails a controlled top level without needing the details', () => {
    expect(homologyStatusFromAclidScreen({ status: 'succeeded', regulatoryStatus: 'controlled' }, null)).toBe(HomologyScreeningStatus.FAILED);
    expect(aclidResultsUnread({ status: 'succeeded', regulatoryStatus: 'controlled' }, null)).toBe(false);
  });

  it('does not treat a failed screen with no regulatory status as a pass', () => {
    expect(homologyStatusFromAclidScreen({ status: 'failed', regulatoryStatus: null }, null)).toBe(HomologyScreeningStatus.UNAVAILABLE);
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

describe('customerScreeningStatus (behaviour 4)', () => {
  it.each([
    ['no_issues_found', 'awaiting', 'PASSED'],
    ['no_sanctions_matches', 'awaiting', 'PASSED'],
    ['all_issues_resolved', 'awaiting', 'PASSED'],
    ['needs_review', 'awaiting', 'NEEDS_REVIEW'],
    ['running', 'awaiting', 'IN_PROGRESS'],
    ['not_run', 'awaiting', 'IN_PROGRESS'],
    ['failed', 'awaiting', 'FAILED'],
    [null, 'awaiting', 'IN_PROGRESS'],
    ['something_new', 'awaiting', 'IN_PROGRESS'],
    ['no_issues_found', 'rejected', 'FAILED'],
    ['running', 'rejected', 'FAILED'],
    [null, 'rejected', 'FAILED'],
    ['needs_review', 'approved', 'PASSED'],
    ['failed', 'approved', 'PASSED'],
    [null, 'approved', 'PASSED'],
    ['running', 'approved', 'IN_PROGRESS'],
    ['not_run', 'approved', 'IN_PROGRESS'],
    ['no_issues_found', 'escalated', 'NEEDS_REVIEW'],
    ['running', 'escalated', 'NEEDS_REVIEW'],
    [null, 'escalated', 'NEEDS_REVIEW'],
    ['failed', 'escalated', 'FAILED']
  ])('verdict %s with decision %s is %s', (verdict, decision, expected) => {
    expect(customerScreeningStatus(verdict, decision)).toBe(expected);
  });
});

describe('jobCustomerStatusFromLeg', () => {
  it.each([
    ['PASSED', 'PASSED'],
    ['FAILED', 'FAILED'],
    ['IN_PROGRESS', 'IN_PROGRESS'],
    ['NEEDS_REVIEW', 'IN_PROGRESS'],
    ['NOT_AVAILABLE', 'UNAVAILABLE'],
    ['NOT_RUN', 'UNAVAILABLE'],
    ['UNAVAILABLE', 'UNAVAILABLE']
  ])('%s stores as %s', (leg, job) => {
    expect(jobCustomerStatusFromLeg(leg as CustomerScreeningStatus)).toBe(job);
  });
});
