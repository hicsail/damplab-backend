import { HomologyScreeningStatus, JobState } from './job.model';
import { CustomerScreeningStatus, JobAcceptanceScreening, JobAcceptanceScreeningState, ScreeningRun } from './screening-run.model';

/**
 * What the acceptance gate tells staff. The wording is a contract with the docs and the UI, and
 * none of it names a finding, a file or a column.
 */
export const ACCEPTANCE_MESSAGES = {
  NOT_RUN: 'This job has not been screened. Run screening before accepting it.',
  RUN_IN_PROGRESS: 'Screening is still running on this job. Accept it once the run finishes.',
  STALE: 'A screened value or the customer details changed after the last screening run. Rerun screening before accepting this job.',
  UNSCREENED: 'Some flagged values could not be screened on the last run. Fix them, then rerun screening.',
  HOMOLOGY_FAILED: 'Homology screening failed on the last run, so this job cannot be accepted. Rerun screening if the job has changed, or request changes.',
  ACLID_IN_PROGRESS: 'Aclid is still screening this job. Refresh results, then accept it.',
  NO_VERDICT: 'The last screening run got no provider verdict. Rerun screening before accepting this job.',
  CUSTOMER_FAILED: 'Customer screening failed on the last run, so this job cannot be accepted. Contact your biosecurity representative about next steps.',
  CUSTOMER_NEEDS_REVIEW: 'Customer screening needs review at Aclid. Refresh results once it is resolved, then accept this job.',
  CUSTOMER_IN_PROGRESS: 'Customer screening is still in progress. Refresh results, then accept this job.',
  CUSTOMER_UNAVAILABLE: 'Customer screening could not be completed on the last run. Rerun screening before accepting this job.',
  CUSTOMER_NOT_SCREENED: 'Customer screening did not run on the last run. Rerun screening before accepting this job.',
  CHECK_FAILED: 'Could not check this job’s screening. Try again, or rerun screening.'
} as const;

/**
 * The states ACCEPT is gated in. An explicit list: `JobState` is a numeric ordinal, so a
 * comparison like `>=` would silently gate or ungate states added later.
 */
const GATED_STATES: JobState[] = [JobState.SUBMITTED, JobState.CHANGES_REQUESTED];

export function isAcceptanceGatedState(state: JobState): boolean {
  return GATED_STATES.includes(state);
}

export interface AcceptanceDecisionInput {
  jobState: JobState;
  newestRun: ScreeningRun | null;
  currentFingerprint: string;
}

type Blocked = { state: JobAcceptanceScreeningState; message: string };

/** Whether the job may be accepted given its newest screening run. Pure; the service does the reads. */
export function decideAcceptanceScreening(input: AcceptanceDecisionInput): JobAcceptanceScreening {
  if (!isAcceptanceGatedState(input.jobState)) return { state: JobAcceptanceScreeningState.NOT_REQUIRED, message: null };
  const blocked = firstBlock(input);
  if (!blocked) return { state: JobAcceptanceScreeningState.CLEAR, message: null };
  return blocked;
}

function firstBlock({ newestRun: run, currentFingerprint }: AcceptanceDecisionInput): Blocked | null {
  const S = JobAcceptanceScreeningState;
  if (!run) return { state: S.NOT_RUN, message: ACCEPTANCE_MESSAGES.NOT_RUN };
  if (!run.completedAt) return { state: S.IN_PROGRESS, message: ACCEPTANCE_MESSAGES.RUN_IN_PROGRESS };
  if (!run.fingerprint || run.fingerprint !== currentFingerprint) return { state: S.STALE, message: ACCEPTANCE_MESSAGES.STALE };
  if ((run.unscreenedNotes ?? []).length > 0) return { state: S.NOT_PASSED, message: ACCEPTANCE_MESSAGES.UNSCREENED };
  if (run.status === HomologyScreeningStatus.FAILED) return { state: S.NOT_PASSED, message: ACCEPTANCE_MESSAGES.HOMOLOGY_FAILED };

  const homologyCleared = run.status === HomologyScreeningStatus.PASSED || (run.status === HomologyScreeningStatus.UNAVAILABLE && run.sequenceCount === 0);
  if (!homologyCleared) {
    if (run.aclid?.homologyStatus === HomologyScreeningStatus.IN_PROGRESS) return { state: S.IN_PROGRESS, message: ACCEPTANCE_MESSAGES.ACLID_IN_PROGRESS };
    return { state: S.NOT_PASSED, message: ACCEPTANCE_MESSAGES.NO_VERDICT };
  }

  const customer = run.customer;
  if (!customer) return { state: S.NOT_PASSED, message: ACCEPTANCE_MESSAGES.CUSTOMER_NOT_SCREENED };
  switch (customer.status) {
    case CustomerScreeningStatus.PASSED:
    case CustomerScreeningStatus.NOT_RUN:
    case CustomerScreeningStatus.NOT_AVAILABLE:
      return null;
    case CustomerScreeningStatus.FAILED:
      return { state: S.NOT_PASSED, message: ACCEPTANCE_MESSAGES.CUSTOMER_FAILED };
    case CustomerScreeningStatus.NEEDS_REVIEW:
      return { state: S.NOT_PASSED, message: ACCEPTANCE_MESSAGES.CUSTOMER_NEEDS_REVIEW };
    case CustomerScreeningStatus.IN_PROGRESS:
      return { state: S.IN_PROGRESS, message: ACCEPTANCE_MESSAGES.CUSTOMER_IN_PROGRESS };
    default:
      return { state: S.NOT_PASSED, message: ACCEPTANCE_MESSAGES.CUSTOMER_UNAVAILABLE };
  }
}
