import { AccessTier, deriveAccessTier, TIER_LABEL } from '../auth/roles/access-tiers';
import { JobVersionAuthorRole } from './job-version.model';

/**
 * The org or team an edit is stamped with, resolved **at write time**.
 *
 * Never derive this when the history is read. Reading it later would report the
 * editor's tier as it stands today rather than the one they held when they made
 * the edit — precisely the thing an audit stamp exists to preserve — and would
 * cost a Keycloak call for every row of a list.
 *
 * The two sides are stamped with different kinds of fact, on purpose:
 *
 *  - **Staff** get their access tier, read straight off the token's realm roles.
 *    "Administrator" and "Technician" are what a reader needs in order to judge
 *    an edit, and they cost nothing to resolve.
 *  - **Customers** get the *job's* institute, which is not the same thing as the
 *    editor's own org: `Job.institute` is free text captured at submission, so on
 *    a staff-submitted job it is whatever staff typed on the form. That is still
 *    the right value for a job-scoped stamp, and there is no per-user org on the
 *    customer side to read instead. Do not "fix" this into a Keycloak lookup.
 *
 * An empty string means "nothing worth saying", which is also what every row
 * written before this field existed carries. The history subtitle drops empties,
 * so those rows show the author's name and side alone.
 */
export function jobVersionAuthorOrg(args: { authorRole: JobVersionAuthorRole; claims?: readonly string[]; institute?: string | null }): string {
  if (args.authorRole === JobVersionAuthorRole.STAFF) {
    const tier = deriveAccessTier(args.claims ?? []);
    return tier === AccessTier.CLIENT ? '' : TIER_LABEL[tier];
  }
  return args.institute?.trim() ?? '';
}
