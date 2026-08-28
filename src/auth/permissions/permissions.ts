import { ForbiddenException } from '@nestjs/common';
import { Permission } from './permission.enum';
import { API_KEY_PERMISSIONS, customerPermissionsForRoles, permissionsForRoles } from './role-permissions';

/** The shape of `request.user` this module needs; deliberately narrower than `User`. */
export interface PermissionActor {
  realm_access?: { roles?: string[] };
  /** Set by the guard's API-key branch. */
  apiKey?: boolean;
}

/**
 * Every permission the actor holds. Gives API-key callers a defined answer rather
 * than an empty set, so field resolvers neither crash nor leak when a key calls them.
 */
export function permissionsFor(actor: PermissionActor | undefined | null): Set<Permission> {
  if (actor?.apiKey === true) return new Set(API_KEY_PERMISSIONS);
  return permissionsForRoles(actor?.realm_access?.roles);
}

/** As `permissionsFor`, but with staff-flavored roles stripped. See Client View. */
export function customerPermissionsFor(actor: PermissionActor | undefined | null): Set<Permission> {
  if (actor?.apiKey === true) return new Set(API_KEY_PERMISSIONS);
  return customerPermissionsForRoles(actor?.realm_access?.roles);
}

export function hasPermission(actor: PermissionActor | undefined | null, permission: Permission): boolean {
  return permissionsFor(actor).has(permission);
}

/** True only if the actor holds every one of the given permissions. */
export function hasAllPermissions(actor: PermissionActor | undefined | null, permissions: readonly Permission[]): boolean {
  const granted = permissionsFor(actor);
  return permissions.every((permission) => granted.has(permission));
}

/** Throws 403 rather than returning false. For use inside resolvers and services. */
export function assertPermission(actor: PermissionActor | undefined | null, permission: Permission): void {
  if (!hasPermission(actor, permission)) {
    throw new ForbiddenException(`Missing permission: ${permission}`);
  }
}
