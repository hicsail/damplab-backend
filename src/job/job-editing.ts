import { Job, JobState } from './job.model';

/**
 * Whether the job's owner may currently change its workflow graph.
 *
 * The single gate. It used to be derived from the job's state — a job was the
 * customer's to edit exactly while it sat in CHANGES_REQUESTED — which conflated
 * two decisions staff want to make separately: *who holds the job* and *may they
 * change it*. Asking a customer to approve the lab's edits, for instance, means
 * handing them the job without handing them the canvas.
 *
 * Absent means false, not "fall back to the old rule". A missing flag is a job
 * that predates the field and has not been migrated (see migrate-job-editing),
 * and locking is the safe reading of an unknown: a customer who cannot edit asks
 * staff, whereas one who should not have been able to edit silently rewrites a
 * spec the lab has already priced.
 */
export function customerMayEdit(job: Pick<Job, 'customerEditingEnabled'>): boolean {
  return job.customerEditingEnabled === true;
}

/**
 * Whether the job is sitting with the customer rather than the lab.
 *
 * Paired with customerMayEdit this is what distinguishes the two things
 * CHANGES_REQUESTED now covers: with editing, the lab is asking for changes;
 * without it, the lab is asking the customer to approve changes it made itself.
 */
export function jobIsWithCustomer(job: Pick<Job, 'state'>): boolean {
  return job.state === JobState.CHANGES_REQUESTED;
}

/**
 * Whether moving a job to `newState` should close customer editing.
 *
 * Editing is a grant that comes with holding the job, and handing the job back
 * ends it. Without this the grant would outlive the hand-back: a customer who
 * resubmits keeps the flag they were given, so they could carry on rewriting the
 * spec while the lab reviews it, and every save would land as a new version
 * mid-review. Under the old state-derived gate that closed by construction; with
 * an explicit flag it has to be closed explicitly.
 *
 * CHANGES_REQUESTED is the exception because it is the one state that means "the
 * job is with the customer" — whoever moves it there has just decided, in the
 * same breath, whether they may edit, and that decision must survive.
 */
export function editingClosedByTransition(newState: JobState): boolean {
  return newState !== JobState.CHANGES_REQUESTED;
}
