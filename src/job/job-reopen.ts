import { CustomerActionRequired, Job, JobState } from './job.model';
import { JobVersion } from '../job-version/job-version.model';

export interface ReopenTarget {
  state: JobState;
  customerActionRequired: CustomerActionRequired | null;
}

/**
 * Where a closed job goes when staff reopen it: the state it was closed from.
 * A close records that state (and the customer action it carried); a job
 * closed before closes recorded it falls back to its history — the last
 * version before the close that carries a state. Null when the job is not
 * closed or nothing says where it was, which refuses the reopen.
 */
export function reopenTarget(job: Pick<Job, 'state' | 'closedFromState' | 'closedFromCustomerAction'>, versions: ReadonlyArray<Pick<JobVersion, 'versionNumber' | 'jobState'>>): ReopenTarget | null {
  if (job.state !== JobState.CLOSED) return null;
  if (job.closedFromState !== undefined && job.closedFromState !== null) {
    return job.closedFromState === JobState.CLOSED ? null : { state: job.closedFromState, customerActionRequired: job.closedFromCustomerAction ?? null };
  }
  const before = [...versions].sort((a, b) => b.versionNumber - a.versionNumber).find((version) => version.jobState !== undefined && version.jobState !== null && version.jobState !== JobState.CLOSED);
  return before ? { state: before.jobState!, customerActionRequired: null } : null;
}
