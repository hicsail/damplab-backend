import { HomologyScreeningStatus } from '../job/job.model';
import { CustomerScreeningStatus } from '../job/screening-run.model';
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
 * True when any sequence's verdict in a screen's `details` is `controlled`.
 *
 * Aclid puts the verdict on each sequence (`MatchGroup.regulatory_status`, keyed by the name the
 * sequence was sent under), and on every `Match` and `Finding` inside it; the screen's own
 * top-level `regulatory_status` can stay empty while all of those say `controlled`. So this walks
 * the whole object rather than trusting one level of the shape.
 */
export function aclidDetailsControlled(details: unknown): boolean {
  if (Array.isArray(details)) return details.some(aclidDetailsControlled);
  if (details === null || typeof details !== 'object') return false;
  return Object.entries(details as Record<string, unknown>).some(([key, value]) => (key === 'regulatory_status' && value === 'controlled') || aclidDetailsControlled(value));
}

/**
 * A succeeded screen whose per-sequence results have not been read has no verdict yet: the top
 * level cannot clear it, because Aclid leaves it empty on a screen full of controlled sequences.
 * A controlled or unrecognised top level is decided without them.
 */
export function aclidResultsUnread(screen: { status?: string | null; regulatoryStatus?: string | null }, details: Record<string, unknown> | null | undefined): boolean {
  return screen.status === 'succeeded' && (!screen.regulatoryStatus || screen.regulatoryStatus === 'not_controlled') && !aclidDetailsControlled(details) && !aclidDetailsClear(details);
}

/**
 * True when `details` carries a readable answer and nothing in it is controlled: at least one
 * group, and every group has a `regulatory_status` of `controlled` or `not_controlled`. `{}`, a
 * non-object, or a group with a null or unknown status is an answer we have not read.
 */
export function aclidDetailsClear(details: unknown): boolean {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return false;
  const groups = Object.values(details as Record<string, unknown>);
  if (groups.length === 0) return false;
  const known = groups.every((g) => g !== null && typeof g === 'object' && ['controlled', 'not_controlled'].includes((g as Record<string, unknown>).regulatory_status as string));
  return known && !aclidDetailsControlled(details);
}

/**
 * A finished Aclid screen is a verdict, taken with its `details` in hand.
 *
 * `controlled` fails: on the screen, or on any sequence, match or finding in `details`. A
 * `succeeded` screen passes only when its details were read (see `aclidDetailsClear`).
 * Without them it has no verdict yet (UNAVAILABLE), whatever the top level says. `failed`,
 * `deleted`, and `archived` with no regulatory status are no verdict either.
 */
export function homologyStatusFromAclidScreen(screen: { status?: string | null; regulatoryStatus?: string | null }, details?: Record<string, unknown> | null): HomologyScreeningStatus {
  if (screen.regulatoryStatus === 'controlled' || aclidDetailsControlled(details)) return HomologyScreeningStatus.FAILED;
  if (screen.status === 'succeeded') {
    // A status we do not recognise is not an answer, whatever the details say.
    if (screen.regulatoryStatus && screen.regulatoryStatus !== 'not_controlled') return HomologyScreeningStatus.UNAVAILABLE;
    return aclidDetailsClear(details) ? HomologyScreeningStatus.PASSED : HomologyScreeningStatus.UNAVAILABLE;
  }
  return homologyStatusFromAclidRegulatory(screen.regulatoryStatus);
}

/** The regulatory status to store: `controlled` when the verdict came from the details. */
export function effectiveAclidRegulatoryStatus(screen: { regulatoryStatus?: string | null }, homologyStatus: HomologyScreeningStatus): string | null {
  if (homologyStatus === HomologyScreeningStatus.FAILED) return 'controlled';
  return screen.regulatoryStatus ?? null;
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

/**
 * The customer leg's status from Aclid's `review.verdict` and `decision_status`.
 * A staff decision (`rejected`, `approved`, `escalated`) outranks the automated
 * verdict, except that an approval cannot pass a check that has not finished and
 * an escalation cannot soften a failed one.
 */
export function customerScreeningStatus(verdict: string | null | undefined, decisionStatus: string | null | undefined): CustomerScreeningStatus {
  const v = verdict?.trim().toLowerCase() ?? '';
  const decision = decisionStatus?.trim().toLowerCase() ?? '';
  if (decision === 'rejected') return CustomerScreeningStatus.FAILED;
  if (decision === 'approved') {
    return v === 'running' || v === 'not_run' ? CustomerScreeningStatus.IN_PROGRESS : CustomerScreeningStatus.PASSED;
  }
  if (decision === 'escalated') {
    return v === 'failed' ? CustomerScreeningStatus.FAILED : CustomerScreeningStatus.NEEDS_REVIEW;
  }
  switch (v) {
    case 'no_issues_found':
    case 'no_sanctions_matches':
    case 'all_issues_resolved':
      return CustomerScreeningStatus.PASSED;
    case 'needs_review':
      return CustomerScreeningStatus.NEEDS_REVIEW;
    case 'failed':
      return CustomerScreeningStatus.FAILED;
    default:
      return CustomerScreeningStatus.IN_PROGRESS;
  }
}

/** The job's Customer row has no NEEDS_REVIEW; a review in flight reads as in progress. */
export function jobCustomerStatusFromLeg(status: CustomerScreeningStatus): HomologyScreeningStatus {
  switch (status) {
    case CustomerScreeningStatus.PASSED:
      return HomologyScreeningStatus.PASSED;
    case CustomerScreeningStatus.FAILED:
      return HomologyScreeningStatus.FAILED;
    case CustomerScreeningStatus.IN_PROGRESS:
    case CustomerScreeningStatus.NEEDS_REVIEW:
      return HomologyScreeningStatus.IN_PROGRESS;
    default:
      return HomologyScreeningStatus.UNAVAILABLE;
  }
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
