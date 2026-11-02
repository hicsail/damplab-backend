import { HomologyScreeningStatus, JobState } from './job.model';
import { CustomerScreeningStatus, JobAcceptanceScreening, JobAcceptanceScreeningState as S } from './screening-run.model';
import { ACCEPTANCE_MESSAGES, decideAcceptanceScreening } from './screening-acceptance.util';

const clearRun: any = {
  status: HomologyScreeningStatus.PASSED,
  completedAt: new Date(),
  sequenceCount: 2,
  fingerprint: 'fp',
  unscreenedNotes: [],
  customer: { status: CustomerScreeningStatus.NOT_AVAILABLE },
  aclid: { homologyStatus: HomologyScreeningStatus.PASSED }
};

const decide = (run: any, over: Record<string, unknown> = {}): JobAcceptanceScreening =>
  decideAcceptanceScreening({ jobState: JobState.SUBMITTED, newestRun: run, currentFingerprint: 'fp', ...over } as any);

const expectDecision = (run: any, state: S, message: keyof typeof ACCEPTANCE_MESSAGES | null, over: Record<string, unknown> = {}): void => {
  const result = decide(run, over);
  expect(result.state).toBe(state);
  expect(result.message).toBe(message ? ACCEPTANCE_MESSAGES[message] : null);
};

describe('decideAcceptanceScreening', () => {
  it('clears a passed run that matches the job', () => expectDecision(clearRun, S.CLEAR, null));

  it.each([[CustomerScreeningStatus.PASSED], [CustomerScreeningStatus.NOT_RUN], [CustomerScreeningStatus.NOT_AVAILABLE]])('clears with customer %s', (status) =>
    expectDecision({ ...clearRun, customer: { status } }, S.CLEAR, null)
  );

  it('gates CHANGES_REQUESTED too', () => expectDecision(null, S.NOT_RUN, 'NOT_RUN', { jobState: JobState.CHANGES_REQUESTED }));

  it.each([JobState.ACCEPTED, JobState.WAITING_FOR_SOW, JobState.QUEUED, JobState.IN_PROGRESS, JobState.COMPLETE, JobState.CLOSED, JobState.REJECTED, JobState.CANCELLED, JobState.CREATING])(
    'is NOT_REQUIRED for job state %s',
    (jobState) => expectDecision(null, S.NOT_REQUIRED, null, { jobState })
  );

  it('NOT_RUN with no run', () => expectDecision(null, S.NOT_RUN, 'NOT_RUN'));
  it('IN_PROGRESS while the run is open', () => expectDecision({ ...clearRun, completedAt: null }, S.IN_PROGRESS, 'RUN_IN_PROGRESS'));
  it('STALE with no fingerprint on the run', () => expectDecision({ ...clearRun, fingerprint: null }, S.STALE, 'STALE'));
  it('STALE when the fingerprint differs', () => expectDecision(clearRun, S.STALE, 'STALE', { currentFingerprint: 'other' }));
  it('stale outranks a failed result', () => expectDecision({ ...clearRun, status: HomologyScreeningStatus.FAILED }, S.STALE, 'STALE', { currentFingerprint: 'other' }));

  const nothing = { status: HomologyScreeningStatus.UNAVAILABLE, sequenceCount: 0, customer: { status: CustomerScreeningStatus.NOT_RUN } };
  it('zero sequences clears', () => expectDecision({ ...clearRun, ...nothing }, S.CLEAR, null));
  it('zero sequences with a note blocks', () => expectDecision({ ...clearRun, ...nothing, unscreenedNotes: ['x'] }, S.NOT_PASSED, 'UNSCREENED'));
  it('a passed run with a note blocks', () => expectDecision({ ...clearRun, unscreenedNotes: ['x'] }, S.NOT_PASSED, 'UNSCREENED'));
  it('treats missing unscreenedNotes as empty', () => expectDecision({ ...clearRun, unscreenedNotes: undefined }, S.CLEAR, null));
  it('homology failed', () => expectDecision({ ...clearRun, status: HomologyScreeningStatus.FAILED }, S.NOT_PASSED, 'HOMOLOGY_FAILED'));
  it('Aclid still running', () =>
    expectDecision({ ...clearRun, status: HomologyScreeningStatus.UNAVAILABLE, aclid: { homologyStatus: HomologyScreeningStatus.IN_PROGRESS } }, S.IN_PROGRESS, 'ACLID_IN_PROGRESS'));
  it('no provider verdict', () =>
    expectDecision({ ...clearRun, status: HomologyScreeningStatus.UNAVAILABLE, sequenceCount: 2, aclid: { homologyStatus: HomologyScreeningStatus.UNAVAILABLE } }, S.NOT_PASSED, 'NO_VERDICT'));

  it.each([
    [CustomerScreeningStatus.FAILED, S.NOT_PASSED, 'CUSTOMER_FAILED'],
    [CustomerScreeningStatus.NEEDS_REVIEW, S.NOT_PASSED, 'CUSTOMER_NEEDS_REVIEW'],
    [CustomerScreeningStatus.IN_PROGRESS, S.IN_PROGRESS, 'CUSTOMER_IN_PROGRESS'],
    [CustomerScreeningStatus.UNAVAILABLE, S.NOT_PASSED, 'CUSTOMER_UNAVAILABLE']
  ] as const)('customer %s', (status, state, message) => expectDecision({ ...clearRun, customer: { status } }, state, message));

  it('customer null', () => expectDecision({ ...clearRun, customer: null }, S.NOT_PASSED, 'CUSTOMER_NOT_SCREENED'));

  it('no message names a finding, a filename or a column', () => {
    const run = { ...clearRun, unscreenedNotes: ['Plate: secret.csv has no column “Insert”'], detail: 'Ricin' };
    const runs = [run, { ...run, status: HomologyScreeningStatus.FAILED }, { ...run, customer: { status: CustomerScreeningStatus.FAILED, detail: 'Ricin' } }, null];
    for (const r of runs) {
      const message = decide(r).message ?? '';
      expect(message).not.toContain('secret.csv');
      expect(message).not.toContain('Ricin');
    }
    for (const text of Object.values(ACCEPTANCE_MESSAGES)) expect(text).not.toMatch(/secret\.csv|Ricin/);
  });
});
