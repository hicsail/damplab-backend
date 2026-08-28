import { Role } from '../roles/roles.enum';
import { ALL_PERMISSIONS, Permission } from './permission.enum';

/**
 * The access matrix, encoded. `docs/access-matrix.md` is its source; when the two
 * disagree, the matrix wins and this file is wrong.
 *
 * Permissions **union** across a user's roles, which is what makes the rollout
 * non-destructive: granting someone `technician` while they still hold
 * `damplab-staff` changes nothing. The restriction bites only when `damplab-staff`
 * is removed — one atomic, instantly reversible swap per user.
 */

/**
 * The floor. Every authenticated user resolves to at least this, regardless of what
 * roles they carry — including a user with no roles at all.
 *
 * Implemented as an explicit union here rather than hung off Keycloak's
 * `default-roles-damplab` composite, so it is predictable and directly testable.
 * Two consequences, and they are the whole reason the rollout is safe: no user can
 * be locked out by a missing role, and the legacy pricing-group -> role mappings
 * never have to be removed — they grant CLIENT to users who have CLIENT anyway.
 *
 * The matrix supports it: every row true for Client is also true for Technician,
 * Equipment User and Administrator, so CLIENT is a strict subset of all three. The
 * scheme fails *open* at the customer level and *closed* above it — the right
 * asymmetry, since the worst case is a customer seeing their own jobs.
 */
export const BASELINE_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.JobsView,
  Permission.CatalogView,
  Permission.ReleaseNotesView,
  Permission.AnnouncementsRead,
  Permission.TrainingRead,
  Permission.BugsReport
]);

/** Alias for readability at the call sites below. Client is the baseline, not a grant. */
const CLIENT = BASELINE_PERMISSIONS;

/**
 * Q7, as the matrix specifies: an equipment user may submit a job for a client and a
 * technician may not. Odd-looking; encoded deliberately.
 */
const EQUIPMENT_USER: readonly Permission[] = Object.freeze([
  ...CLIENT,
  Permission.JobSubmitForClient,
  Permission.InventoryRead,
  Permission.InventoryBook,
  // Amended after the transcription, on request: equipment users reach Inventory
  // Schedule and My Bench. My Bench self-scopes (`assignedOperations` resolves by
  // `user.sub`); the schedule does not, so cancel is owner-gated and confirm-usage
  // stays Administrator-only. See docs/access-matrix.md, "Amendments".
  Permission.InventorySchedule,
  Permission.BenchUse,
  Permission.LabMonitorView
]);

const TECHNICIAN: readonly Permission[] = Object.freeze([
  ...CLIENT,
  Permission.JobsViewAll,
  Permission.BugBacklogView,
  Permission.CatalogEditorRead,
  Permission.ProtocolLibraryRead,
  Permission.ProtocolLibraryWrite,
  Permission.LabLayoutRead,
  Permission.InventoryRead,
  Permission.InventoryBook,
  Permission.InventorySchedule,
  Permission.LabMonitorView,
  Permission.BenchUse,
  // Amended after the transcription, on request. See docs/access-matrix.md.
  Permission.LabAssistantUse,
  Permission.InternalFieldsRead
]);

/** Administrator holds everything, by construction, so day-one staff access is unchanged. */
const ADMINISTRATOR: readonly Permission[] = ALL_PERMISSIONS;

/**
 * Keyed by plain role strings rather than by the `Role` enum. That is what keeps a
 * later `damplab-staff` -> `administrator` rename cheap: Keycloak renames a realm
 * role in place, preserving assignments, and only this table's key would move.
 */
export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  [Role.DamplabStaff]: ADMINISTRATOR,
  [Role.Technician]: TECHNICIAN,
  [Role.ClientUnassistedEquipmentUser]: EQUIPMENT_USER,
  // Legacy, and redundant with the baseline. Kept so the mappings never have to be
  // removed from the realm; removing them is the one destructive act available here
  // and it buys nothing the baseline has not already bought.
  [Role.InternalCustomer]: CLIENT,
  [Role.ExternalCustomer]: CLIENT
};

/**
 * The roles `myPermissions.asCustomer` subtracts, to power the staff "Client View"
 * toggle. Enumerated explicitly rather than inferred, because the interesting case
 * is the one that must NOT be here: `client-unassisted-equipment-user` is a client
 * variant, not a staff role, so an equipment user in Client View still sees their
 * equipment-user controls.
 */
export const STAFF_FLAVORED_ROLES: readonly string[] = Object.freeze([Role.DamplabStaff, Role.Technician]);

/**
 * What an `x-api-key` caller may do, expressed in the same vocabulary as everyone
 * else rather than as a bypass.
 *
 * Read-only by construction (the guard already rejects non-query operations) and
 * deliberately excludes `internal-fields:read`, so a key cannot pull staff-only
 * fields out of the catalog or inventory.
 *
 * NOTE, and it is a real gap: the guard still returns before the `@Roles` check for
 * API-key callers, so a key continues to satisfy every `@Roles(DamplabStaff)` query
 * exactly as it does today. Closing that narrows existing integrations, so it
 * belongs with the rest of the narrowing work, not here.
 */
export const API_KEY_PERMISSIONS: readonly Permission[] = Object.freeze([
  Permission.JobsView,
  Permission.JobsViewAll,
  Permission.CatalogView,
  Permission.CatalogEditorRead,
  Permission.ProtocolLibraryRead,
  Permission.LabLayoutRead,
  Permission.InventoryRead,
  Permission.InventorySchedule,
  Permission.LabMonitorView,
  Permission.ReleaseNotesView,
  Permission.AnnouncementsRead,
  Permission.TrainingRead
]);

/**
 * Resolve a set of realm-role strings to the permissions they grant, always
 * including the baseline. Unknown role strings contribute nothing and are not an
 * error — that is what lets this deploy before the realm has the new roles.
 */
export function permissionsForRoles(roles: readonly string[] | undefined | null): Set<Permission> {
  const granted = new Set<Permission>(BASELINE_PERMISSIONS);
  for (const role of roles ?? []) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) {
      granted.add(permission);
    }
  }
  return granted;
}

/**
 * The permissions the caller would have with their staff-flavored roles removed —
 * what the UI's Client View toggle previews.
 *
 * This is a UI illusion and stays one: `ViewModeContext` is in-memory state and the
 * real JWT still carries `damplab-staff`, so a staff user in Client View retains
 * full backend authority. It previews the UI; it does not impersonate.
 */
export function customerPermissionsForRoles(roles: readonly string[] | undefined | null): Set<Permission> {
  return permissionsForRoles((roles ?? []).filter((role) => !STAFF_FLAVORED_ROLES.includes(role)));
}
