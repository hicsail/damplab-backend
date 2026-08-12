import { ForbiddenException } from '@nestjs/common';
import { Role } from '../auth/roles/roles.enum';
import { User } from '../auth/user.interface';

/**
 * Who may read a given SOW.
 *
 * A SOW carries the client's name, email, institution, pricing and signature, so
 * reads are restricted to DampLab staff, the customer who owns the underlying job,
 * and trusted external systems authenticating with an API key.
 *
 * Ownership matches on email or sub, the same pair SOWService.submitSignature uses
 * to decide who may sign. Keeping the two definitions identical matters: a customer
 * who can sign a SOW must also be able to read it.
 */

export function isStaff(user: User | undefined): boolean {
  return (user?.realm_access?.roles ?? []).includes(Role.DamplabStaff);
}

export function isJobOwner(job: { email?: string; sub?: string } | null | undefined, user: User | undefined): boolean {
  if (!job || !user) return false;
  // Guard against a job with no owner fields matching a user with none either.
  if (job.sub && user.sub && job.sub === user.sub) return true;
  if (job.email && user.email && job.email === user.email) return true;
  return false;
}

/**
 * API-key callers are external systems granted read-only GraphQL access; the key
 * itself is the authorization (see AuthRolesGuard.authorizeApiKey), so they carry
 * no roles and match no owner. Without this they would lose SOW read access.
 */
export function isApiKeyCaller(user: User | undefined): boolean {
  return user?.apiKey === true;
}

export function canReadSow(job: { email?: string; sub?: string } | null | undefined, user: User | undefined): boolean {
  return isStaff(user) || isApiKeyCaller(user) || isJobOwner(job, user);
}

export function assertCanReadSow(job: { email?: string; sub?: string } | null | undefined, user: User | undefined): void {
  if (!canReadSow(job, user)) {
    throw new ForbiddenException('You do not have permission to view this SOW');
  }
}

/**
 * Whether the caller sees the full version history or only what was issued.
 *
 * Staff see every version, including unsent drafts — that is the point of being
 * able to iterate before sending. Everyone else, including API-key callers, sees
 * only versions marked visibleToCustomer, so internal drafting never leaks.
 */
export function canSeeAllVersions(user: User | undefined): boolean {
  return isStaff(user);
}

export function assertStaff(user: User | undefined, action = 'perform this action'): void {
  if (!isStaff(user)) {
    throw new ForbiddenException(`Only DampLab staff can ${action}`);
  }
}

/**
 * Signing is the one action reserved for the customer: it records their assent,
 * so staff must not be able to produce it on their behalf.
 */
export function assertJobOwner(job: { email?: string; sub?: string } | null | undefined, user: User | undefined): void {
  if (!isJobOwner(job, user)) {
    throw new ForbiddenException('Only the customer who owns this job can sign its SOW');
  }
}
