import { ForbiddenException } from '@nestjs/common';
import { User } from '../auth/user.interface';

/** The one Keycloak read the gate needs. KeycloakService satisfies it. */
export interface BiosecurityVisibility {
  userShowsBiosecurity?: (userId: string | undefined) => Promise<boolean>;
}

/**
 * Whether this account sees the Biosecurity block — the per-account Keycloak attribute
 * `showBiosecurity` (absent reads as true). A missing method (unit harnesses that never
 * construct Keycloak) or a caller with no sub is treated as shown, as JobResolver always has.
 */
export async function callerShowsBiosecurity(keycloak: BiosecurityVisibility | null | undefined, user: User): Promise<boolean> {
  const read = keycloak?.userShowsBiosecurity;
  if (typeof read !== 'function' || !user?.sub) return true;
  return read.call(keycloak, user.sub);
}

/** The inline half of every biosecurity read's gate; the decorator half is `jobs:view-all`. */
export async function assertShowsBiosecurity(keycloak: BiosecurityVisibility | null | undefined, user: User): Promise<void> {
  if (!(await callerShowsBiosecurity(keycloak, user))) {
    throw new ForbiddenException('Biosecurity is not enabled for this account');
  }
}
