import { matchesClientEmail } from './client-email';

/**
 * Whether a caller is *on* a job: the person who submitted it, the client a
 * staff member named when submitting on their behalf, or someone who sees every
 * job anyway.
 *
 * The same pair `ownedJobsFilter` and `ownJobById` use, lifted out so the
 * mutations that open a job to its customer (Aclid KYC, for now) share one rule
 * instead of each re-deriving it. `seesEveryJob` is passed in rather than read
 * from the token here, so the caller decides which permission means "every
 * job" — at present `jobs:view-all`.
 *
 * Deliberately not `mayReadJobFinancials`: that one is about a job's money and
 * carries billing-specific wording; this is about the job itself.
 */
export function callerMayAccessJob(job: { sub?: string; clientEmail?: string } | null, user: { sub: string; email?: string }, seesEveryJob: boolean): boolean {
  if (!job) return false;
  if (seesEveryJob) return true;
  if (job.sub && job.sub === user.sub) return true;
  return matchesClientEmail(job.clientEmail, user.email);
}
