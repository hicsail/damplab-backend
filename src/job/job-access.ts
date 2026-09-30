import { isJobMember, JobMembershipActor, JobMembershipSubject } from './job-membership';

/**
 * Whether a caller is *on* a job: anyone `isJobMember` admits (the submitter, the
 * client a staff member named, or a member added later), or someone who sees
 * every job anyway.
 *
 * The same rule `jobMembersFilter` and `ownJobById` use, lifted out so the
 * mutations that open a job to its customer (Aclid KYC, for now) share one rule
 * instead of each re-deriving it. `seesEveryJob` is passed in rather than read
 * from the token here, so the caller decides which permission means "every
 * job" — at present `jobs:view-all`.
 *
 * Deliberately not `mayReadJobFinancials`: that one is about a job's money and
 * carries billing-specific wording; this is about the job itself.
 */
export function callerMayAccessJob(job: JobMembershipSubject | null, user: JobMembershipActor, seesEveryJob: boolean): boolean {
  if (!job) return false;
  if (seesEveryJob) return true;
  return isJobMember(job, user);
}
