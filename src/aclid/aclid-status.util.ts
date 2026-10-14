import { HomologyScreeningStatus } from '../job/job.model';
import { normalizeSequenceString } from '../job/job-screening.util';
import { ACLID_MIN_SEQUENCE_LENGTH } from './aclid.constants';

export type BiosecurityHomologyMode = 'aclid' | 'securedna' | 'both';

export { ACLID_MIN_SEQUENCE_LENGTH };

const VALID_HOMOLOGY_MODES: BiosecurityHomologyMode[] = ['aclid', 'securedna', 'both'];

export function parseHomologyMode(raw: string | undefined, aclidConfigured: boolean): BiosecurityHomologyMode {
  if (!aclidConfigured) {
    return 'securedna';
  }
  const normalized = raw?.trim().toLowerCase();
  if (normalized && VALID_HOMOLOGY_MODES.includes(normalized as BiosecurityHomologyMode)) {
    return normalized as BiosecurityHomologyMode;
  }
  return 'aclid';
}

export function homologyStatusFromAclidRegulatory(regulatoryStatus: string | null | undefined): HomologyScreeningStatus {
  if (regulatoryStatus === 'controlled') {
    return HomologyScreeningStatus.FAILED;
  }
  if (regulatoryStatus === 'not_controlled') {
    return HomologyScreeningStatus.PASSED;
  }
  return HomologyScreeningStatus.UNAVAILABLE;
}

/**
 * A finished Aclid screen is a verdict.
 *
 * `controlled` fails. `not_controlled` passes. A screen whose status is
 * `succeeded` and whose `regulatory_status` is empty also passes: that is how
 * Aclid reports a clear screen, and it is not a reason to ask SecureDNA.
 * `failed`, `deleted`, and `archived` with no regulatory status are still no
 * verdict.
 */
export function homologyStatusFromAclidScreen(screen: { status?: string | null; regulatoryStatus?: string | null }): HomologyScreeningStatus {
  const regulatory = homologyStatusFromAclidRegulatory(screen.regulatoryStatus);
  if (regulatory !== HomologyScreeningStatus.UNAVAILABLE) return regulatory;
  if (!screen.regulatoryStatus && screen.status === 'succeeded') return HomologyScreeningStatus.PASSED;
  return HomologyScreeningStatus.UNAVAILABLE;
}

/**
 * What the customer is allowed to know about identity verification.
 *
 * `submitted` is Aclid's own word for "they sent it". A completed timestamp or
 * a decision means the same thing without naming the decision. `not_required`
 * is Aclid saying this order does not need KYC. Everything else, including
 * `partially_submitted`, is still not submitted — the button stays available.
 */
export type CustomerVerificationState = 'unavailable' | 'not_submitted' | 'submitted' | 'not_required';

export function customerVerificationState(
  screening?: {
    screenId?: string | null;
    verificationStatus?: string | null;
    verificationCompletedAt?: Date | string | null;
    decisionStatus?: string | null;
  } | null
): CustomerVerificationState {
  if (!screening?.screenId) return 'unavailable';
  const status = screening.verificationStatus?.trim().toLowerCase();
  if (status === 'not_required') return 'not_required';
  if (status === 'submitted') return 'submitted';
  if (screening.verificationCompletedAt) return 'submitted';
  const decision = screening.decisionStatus?.trim().toLowerCase();
  if (decision === 'approved' || decision === 'rejected') return 'submitted';
  return 'not_submitted';
}

export function customerStatusFromAclid(input: {
  screenId?: string | null;
  decisionStatus?: string | null;
  verificationStatus?: string | null;
  screenHomologyStatus?: HomologyScreeningStatus | null;
}): HomologyScreeningStatus {
  if (!input.screenId) {
    return HomologyScreeningStatus.UNAVAILABLE;
  }

  const decisionStatus = input.decisionStatus?.toLowerCase();
  const verificationStatus = input.verificationStatus?.toLowerCase();

  if (decisionStatus === 'rejected') {
    return HomologyScreeningStatus.FAILED;
  }
  if (decisionStatus === 'approved' || verificationStatus === 'not_required') {
    return HomologyScreeningStatus.PASSED;
  }

  return HomologyScreeningStatus.IN_PROGRESS;
}

export function rollupHomologyStatuses(statuses: HomologyScreeningStatus[]): HomologyScreeningStatus {
  if (statuses.some((s) => s === HomologyScreeningStatus.FAILED)) {
    return HomologyScreeningStatus.FAILED;
  }
  if (statuses.some((s) => s === HomologyScreeningStatus.IN_PROGRESS)) {
    return HomologyScreeningStatus.IN_PROGRESS;
  }
  if (statuses.some((s) => s === HomologyScreeningStatus.PASSED)) {
    return HomologyScreeningStatus.PASSED;
  }
  return HomologyScreeningStatus.UNAVAILABLE;
}

export function isAclidLengthEligible(seq: string): boolean {
  return normalizeSequenceString(seq).length >= ACLID_MIN_SEQUENCE_LENGTH;
}
