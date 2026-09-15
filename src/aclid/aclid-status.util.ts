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

export function homologyStatusFromAclidRegulatory(
  regulatoryStatus: string | null | undefined
): HomologyScreeningStatus {
  if (regulatoryStatus === 'controlled') {
    return HomologyScreeningStatus.FAILED;
  }
  if (regulatoryStatus === 'not_controlled') {
    return HomologyScreeningStatus.PASSED;
  }
  return HomologyScreeningStatus.UNAVAILABLE;
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
