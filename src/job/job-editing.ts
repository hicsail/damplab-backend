import { ForbiddenException } from '@nestjs/common';
import { CustomerActionRequired, Job, JobState } from './job.model';

/**
 * Who may change a job's contract — its workflow graph, its parameters, its
 * pricing — and when.
 *
 * One rule: **you may change a thing only while you hold it, and only while it
 * is uncommitted.**
 *
 *   CREATING, SUBMITTED     the lab holds it, nothing is agreed   → staff edit
 *   CHANGES_REQUESTED       the customer holds it                 → the customer edits, and only when asked to
 *   ACCEPTED                the lab holds it, the spec is agreed  → nobody edits until acceptance is withdrawn
 *   QUEUED and beyond       the lab is executing it               → only what assertWorkInFlightUntouched allows
 *   CLOSED                  finished                              → nobody
 *
 * Staff used to be able to edit in any state but CLOSED. That is what let a
 * technician rewrite a job while the customer was editing it, or move a spec
 * out from under an acceptance the SOW was priced against — and most of the
 * blocker machinery on the SOW side existed to detect that after the fact.
 * Making control exclusive turns those detections into transitions: to edit an
 * accepted job you withdraw the acceptance, and to edit one the customer holds
 * you withdraw it from them.
 *
 * This governs the *contract*. Lab execution — assigning a node, recording
 * inventory, ticking off steps — is not editing what was agreed and stays
 * staff-only-as-is.
 */

/** Whether the job is sitting with the customer rather than the lab. */
export function jobIsWithCustomer(job: Pick<Job, 'state'>): boolean {
  return job.state === JobState.CHANGES_REQUESTED;
}

/**
 * Whether the job's owner may currently change its workflow graph.
 *
 * Both halves matter: the state proves the customer holds the job, and the
 * requested action distinguishes "make these changes" from a read-only reply or
 * approval. `customerEditingEnabled` used to carry the second half as its own
 * flag; it was always exactly this comparison, so it is gone.
 */
export function customerMayEdit(job: Pick<Job, 'state' | 'customerActionRequired'>): boolean {
  return jobIsWithCustomer(job) && job.customerActionRequired === CustomerActionRequired.EDIT_WORKFLOW;
}

/**
 * The customer is being asked to sign off on the lab's edits rather than to make
 * edits of their own: the job is theirs to act on but not to change.
 */
export function awaitingCustomerApproval(job: Pick<Job, 'state' | 'customerActionRequired'>): boolean {
  return jobIsWithCustomer(job) && job.customerActionRequired === CustomerActionRequired.APPROVE_WORKFLOW;
}

/** States in which the lab holds the job and has not yet committed to its spec. */
const STAFF_EDITABLE_STATES: readonly JobState[] = [JobState.CREATING, JobState.SUBMITTED, JobState.QUEUED, JobState.IN_PROGRESS, JobState.COMPLETE];

/** Whether staff may currently change this job's contract. */
export function staffMayEdit(job: Pick<Job, 'state'>): boolean {
  return STAFF_EDITABLE_STATES.includes(job.state);
}

/**
 * Why staff cannot edit right now, or null when they can.
 *
 * Every message names the action that would unblock them, because "forbidden"
 * on a job a technician is looking at is otherwise indistinguishable from a bug.
 */
export function staffEditBlockedReason(job: Pick<Job, 'state'>): string | null {
  if (staffMayEdit(job)) return null;
  switch (job.state) {
    case JobState.CHANGES_REQUESTED:
      return 'This job is with the customer. Withdraw it from them before editing, which restores the workflow to the version they were sent.';
    case JobState.ACCEPTED:
      return 'This job has been accepted and its Statement of Work is priced against that spec. Withdraw the acceptance before editing.';
    case JobState.WAITING_FOR_SOW:
      return 'This job is waiting on its Statement of Work and cannot be edited.';
    case JobState.CLOSED:
      return 'This job is closed and can no longer be edited.';
    case JobState.REJECTED:
      return 'This job was not accepted and can no longer be edited.';
    case JobState.CANCELLED:
      return 'This job was cancelled by the client and can no longer be edited.';
    default:
      return 'This job cannot be edited in its current state.';
  }
}

/**
 * The gate every contract write goes through, for staff and customers alike.
 *
 * `isOwner` and `isStaff` are passed in rather than derived here so this stays
 * free of the auth types and can be unit-tested against the table above.
 */
export function assertJobContractWritable(job: Pick<Job, 'state' | 'customerActionRequired'>, actor: { isStaff: boolean; isOwner: boolean }): void {
  if (actor.isStaff) {
    const reason = staffEditBlockedReason(job);
    if (reason) throw new ForbiddenException(reason);
    return;
  }

  if (!actor.isOwner) throw new ForbiddenException('You do not have permission to edit this job');
  if (!customerMayEdit(job)) {
    throw new ForbiddenException(customerEditBlockedReason(job));
  }
}

/** Why the customer cannot edit right now. Assumes they own the job. */
export function customerEditBlockedReason(job: Pick<Job, 'state' | 'customerActionRequired'>): string {
  const seeComments = 'See the comments on the job for details.';
  if (awaitingCustomerApproval(job)) {
    return `Editing is not enabled for this job — the lab has asked you to approve it rather than change it. ${seeComments}`;
  }
  if (jobIsWithCustomer(job) && job.customerActionRequired === CustomerActionRequired.REPLY) {
    return `Editing is not enabled for this job — the lab is waiting for your reply. ${seeComments}`;
  }
  return `This job is with the DAMP Lab and cannot be edited right now. ${seeComments}`;
}
