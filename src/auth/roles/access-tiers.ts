import { registerEnumType } from '@nestjs/graphql';
import { Role } from './roles.enum';
import { claimMatches, claimsFromGroupList } from '../../pricing/pricing-groups';

/**
 * The four access columns of `docs/access-matrix.md`, as one table.
 *
 * This is the access axis and **only** the access axis. Pricing is entirely separate
 * (`pricing/pricing-groups.ts`): any pricing group combines with any access tier, and
 * a write to one must never disturb the other. That separation is the single most
 * consequential invariant in this file — `setUserAccessTier` clearing a pricing group
 * would silently reprice a customer.
 *
 * Three namespaces meet here and they do not spell things the same way:
 *
 * | Tier | Group (what admins assign, what we write) | Realm role (what the guard reads) |
 * |---|---|---|
 * | ADMINISTRATOR | `damplab-staff` | `damplab-staff` |
 * | TECHNICIAN | `technician` | `technician` |
 * | EQUIPMENT_USER | `client-unassisted-equipment-users` *(plural)* | `client-unassisted-equipment-user` *(singular)* |
 * | CLIENT | *(none)* | *(none)* |
 *
 * Writing a group grants nothing on its own — `auth.guard.ts` reads
 * `realm_access.roles`, so the realm must map each group to its role. A missing
 * mapping makes the write a silent no-op, which is why the resolver reads the user's
 * realm roles back after writing rather than trusting the PUT.
 */
export enum AccessTier {
  ADMINISTRATOR = 'ADMINISTRATOR',
  TECHNICIAN = 'TECHNICIAN',
  EQUIPMENT_USER = 'EQUIPMENT_USER',
  /**
   * The floor. Not a grant and not assignable as one: a user is a Client precisely
   * when they carry no access group at all, which is why `TIER_GROUP` maps it to
   * `null`. Setting someone to CLIENT means removing every access group.
   *
   * It is still a first-class enum value rather than a null argument, so the mutation
   * signature stays `tier: AccessTier!` and callers need no special case for the one
   * tier that is otherwise the simplest.
   */
  CLIENT = 'CLIENT'
}
registerEnumType(AccessTier, { name: 'AccessTier', description: 'An access column of the DAMPLab access matrix. CLIENT is the floor — it means "no access group".' });

/** The group written when an admin assigns a tier. `null` for CLIENT: see above. */
export const TIER_GROUP: Record<AccessTier, string | null> = {
  [AccessTier.ADMINISTRATOR]: 'damplab-staff',
  [AccessTier.TECHNICIAN]: 'technician',
  [AccessTier.EQUIPMENT_USER]: 'client-unassisted-equipment-users',
  [AccessTier.CLIENT]: null
};

/** The realm role each tier's group is expected to map to. Used for the read-back check. */
export const TIER_ROLE: Record<AccessTier, Role | null> = {
  [AccessTier.ADMINISTRATOR]: Role.DamplabStaff,
  [AccessTier.TECHNICIAN]: Role.Technician,
  [AccessTier.EQUIPMENT_USER]: Role.ClientUnassistedEquipmentUser,
  [AccessTier.CLIENT]: null
};

/**
 * Every group membership `setUserAccessTier` is allowed to remove.
 *
 * Deliberately **not** derived by filtering "all groups that aren't pricing groups":
 * an allow-list cannot strip a group nobody anticipated, whereas a deny-list would
 * strip every future group the realm gains. If a new access tier is added, it is
 * added here explicitly.
 */
export const ACCESS_GROUP_NAMES: readonly string[] = Object.freeze(
  [TIER_GROUP[AccessTier.ADMINISTRATOR], TIER_GROUP[AccessTier.TECHNICIAN], TIER_GROUP[AccessTier.EQUIPMENT_USER]].filter((name): name is string => name !== null)
);

/** True if this group is one the access-tier write is permitted to touch. */
export function isAccessGroupName(name: string | undefined): boolean {
  return Boolean(name && ACCESS_GROUP_NAMES.includes(name));
}

/**
 * The tier a set of claims resolves to.
 *
 * Highest wins, because permissions union across roles: someone holding both
 * `damplab-staff` and `technician` has Administrator access, so reporting them as a
 * Technician would misdescribe what they can do. `claims` may mix group names, group
 * paths and realm roles — all are matched the same way, so this serves both the
 * Admin API (group list) and a token.
 */
export function deriveAccessTier(claims: readonly string[]): AccessTier {
  const has = (name: string | null): boolean => Boolean(name) && claims.some((entry) => claimMatches(entry, name as string));
  // Both spellings, so a user carrying only the realm role — no group — still reports
  // the tier their token actually grants.
  if (has(TIER_GROUP[AccessTier.ADMINISTRATOR]) || has(TIER_ROLE[AccessTier.ADMINISTRATOR])) return AccessTier.ADMINISTRATOR;
  if (has(TIER_GROUP[AccessTier.TECHNICIAN]) || has(TIER_ROLE[AccessTier.TECHNICIAN])) return AccessTier.TECHNICIAN;
  if (has(TIER_GROUP[AccessTier.EQUIPMENT_USER]) || has(TIER_ROLE[AccessTier.EQUIPMENT_USER])) return AccessTier.EQUIPMENT_USER;
  return AccessTier.CLIENT;
}

/** Convenience wrapper for callers holding an Admin API group list. */
export function deriveAccessTierFromGroups(groups: { name?: string; path?: string }[]): AccessTier {
  return deriveAccessTier(claimsFromGroupList(groups));
}

/** The tiers an administrator may preview in the header's view-as dropdown. */
export const LESSER_TIERS: readonly AccessTier[] = Object.freeze([AccessTier.TECHNICIAN, AccessTier.EQUIPMENT_USER, AccessTier.CLIENT]);

/** Human labels, shared by the dropdown and the Customer Management select. */
export const TIER_LABEL: Record<AccessTier, string> = {
  [AccessTier.ADMINISTRATOR]: 'Administrator',
  [AccessTier.TECHNICIAN]: 'Technician',
  [AccessTier.EQUIPMENT_USER]: 'Equipment User',
  [AccessTier.CLIENT]: 'Client'
};
