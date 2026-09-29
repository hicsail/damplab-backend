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
 * The address that identifies a job's *client*, as a Mongo expression.
 *
 * `clientEmail` when staff submitted on someone's behalf, otherwise the
 * submitter's own `email`. Every job has one, which is what makes it usable as
 * the identity the staff jobs page groups and filters by — `sub` cannot be, since
 * a staff-submitted job carries the technician's sub and the client's appears
 * nowhere on the document.
 *
 * Normalised the same way `normalizeClientEmail` normalises in JS, so grouping,
 * filtering and the ownership checks all agree on who is who.
 */
export function effectiveClientEmailExpr(): Record<string, unknown> {
  const raw = { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$clientEmail', ''] } }, 0] }, '$clientEmail', { $ifNull: ['$email', ''] }] };
  return { $toLower: { $trim: { input: raw } } };
}
