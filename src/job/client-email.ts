import * as mongoose from 'mongoose';

/**
 * The client email on a job, and how it is compared.
 *
 * When staff submit a job for a client, the job's `sub` and `email` belong to the
 * staff member — they come from the submitter's token. `clientEmail` is the only
 * link back to the client, and unlike every other identity field on a job it is
 * *typed by hand* into the staff submission form. So `Client@BU.edu` and
 * `client@bu.edu` are the same person, and an exact `===` against the Keycloak
 * address silently hides the job.
 *
 * Everything therefore goes through here: normalised on write, normalised on
 * compare, and — for the list query, which cannot re-read a legacy row through JS
 * — compared case-insensitively in Mongo as well, so jobs stored before this
 * existed still resolve.
 */
export function normalizeClientEmail(email: string | null | undefined): string | undefined {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

/** Whether a job's recorded client email is this user's, ignoring case and padding. */
export function matchesClientEmail(jobClientEmail: string | null | undefined, userEmail: string | null | undefined): boolean {
  const job = normalizeClientEmail(jobClientEmail);
  const user = normalizeClientEmail(userEmail);
  return job !== undefined && user !== undefined && job === user;
}

/**
 * The "jobs this person owns" filter: their own submissions, plus the ones staff
 * submitted naming them.
 *
 * `$expr`/`$toLower` rather than a plain equality so a row written before emails
 * were normalised still matches. The guard is load-bearing, not defensive: with
 * no address to match, `$toLower` of a missing `clientEmail` is `""`, which would
 * equal an empty needle and hand the caller every job that has no client email —
 * that is to say, every ordinary job in the collection.
 */
export function ownedJobsFilter(sub: string, email: string | null | undefined): mongoose.FilterQuery<any> {
  const normalized = normalizeClientEmail(email);
  if (!normalized) return { sub };
  // $trim as well as $toLower: normalizeClientEmail trims, so a stored value with
  // stray padding would compare unequal here while comparing equal in JS -- the
  // list would hide a job the detail page happily opens. ($trim of a missing
  // field is null, and $toLower of null is "", which the guard above has already
  // ruled out as a needle.)
  return { $or: [{ sub }, { $expr: { $eq: [{ $toLower: { $trim: { input: '$clientEmail' } } }, normalized] } }] };
}
