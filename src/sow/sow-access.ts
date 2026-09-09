import { ForbiddenException } from '@nestjs/common';
import { Role } from '../auth/roles/roles.enum';
import { User } from '../auth/user.interface';
import { matchesClientEmail } from '../job/client-email';

/**
 * Who may read a given SOW.
 *
 * A SOW carries the client's name, email, institution, pricing and signature, so
 * reads are restricted to DampLab staff, the customer who owns the underlying job,
 * and trusted external systems authenticating with an API key.
 *
 * Ownership matches on sub, email, or the clientEmail staff recorded when they
 * submitted the job on someone's behalf. Reading and signing share this one
 * definition (signSow reaches it via assertJobOwner), which is what keeps a
 * customer who can sign a SOW able to read it.
 */

export function isStaff(user: User | undefined): boolean {
  return (user?.realm_access?.roles ?? []).includes(Role.DamplabStaff);
}

export function isJobOwner(job: { email?: string; sub?: string; clientEmail?: string } | null | undefined, user: User | undefined): boolean {
  if (!job || !user) return false;
  // Guard against a job with no owner fields matching a user with none either.
  if (job.sub && user.sub && job.sub === user.sub) return true;
  if (job.email && user.email && job.email === user.email) return true;
  if (matchesClientEmail(job.clientEmail, user.email)) return true;
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

export function canReadSow(job: { email?: string; sub?: string; clientEmail?: string } | null | undefined, user: User | undefined): boolean {
  return isStaff(user) || isApiKeyCaller(user) || isJobOwner(job, user);
}

export function assertCanReadSow(job: { email?: string; sub?: string; clientEmail?: string } | null | undefined, user: User | undefined): void {
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
 * Signing and declining are the actions reserved for the customer: each records
 * their own answer, so staff must not be able to produce either on their behalf.
 * Staff take a document back with withdrawSowFromCustomer instead.
 *
 * `action` names what was attempted — telling someone who tried to decline that
 * they cannot "sign" reads as the wrong refusal for the wrong act.
 */
export function assertJobOwner(job: { email?: string; sub?: string; clientEmail?: string } | null | undefined, user: User | undefined, action = 'sign'): void {
  if (!isJobOwner(job, user)) {
    throw new ForbiddenException(`Only the customer who owns this job can ${action} its SOW`);
  }
}

/**
 * Whether staff may currently change a SOW's content, and why not when they
 * cannot.
 *
 * A SOW is "with the customer" only while its active version is SENT and
 * unsigned — SIGNED means they have acted and the ball is back with the lab. So
 * there are three cases, not one:
 *
 *   SENT    the customer is being asked to sign it → withdraw it first
 *   SIGNED  editable; a new draft sits above it and blocks countersign until
 *           staff send that draft or restore the signed version
 *   FINAL   countersigned by both parties; a executed contract is not edited,
 *           it is cancelled and replaced
 *
 * Returns null when nothing is in the way. The SIGNED case is deliberately not
 * a blocker: saving a revision is allowed, and the signature stays in force.
 */
export function sowEditBlockedReason(activeStatus: string | null | undefined): string | null {
  if (activeStatus === 'SENT') {
    return 'This Statement of Work is with the customer for signature. Withdraw it before editing, and the customer will be told it is no longer available to sign.';
  }
  if (activeStatus === 'FINAL') {
    return 'This Statement of Work has been countersigned and is final. Cancel it and issue a new one to change its terms.';
  }
  return null;
}

export function assertSowContractWritable(activeStatus: string | null | undefined): void {
  const reason = sowEditBlockedReason(activeStatus);
  if (reason) throw new ForbiddenException(reason);
}

/**
 * What an invoice bills against: a countersigned Statement of Work, and nothing
 * else.
 *
 * Lives here rather than in the invoice service because this file already owns
 * "what state is this document in" (`sowEditBlockedReason`), and the two rules are
 * neighbours — one says when a SOW may be *changed*, this one when it may be
 * *billed*.
 *
 * `FINAL` is countersigned by both parties, set by `SowVersionService.finalize`.
 * `SENT` and `SIGNED` are not enough: the customer has not agreed, or has agreed
 * while the lab has not. With no version in force at all there is nothing to bill
 * against — invoicing then fell back to the SOW's *live* billing core, which the
 * workflow sync rewrites, so the figure billed was one no document ever stated.
 *
 * Four refusals rather than one, because a reader told a SOW "has not been
 * countersigned" when they countersigned it themselves will conclude the software
 * lost their signature.
 *
 * A note on the `everCountersigned` branch: it is **defensive, not a live case**.
 * A countersigned SOW cannot be withdrawn (`withdrawFromCustomer` accepts only a
 * SENT document) and cannot be amended (`assertSowContractWritable` refuses FINAL),
 * so cancelling is its one exit — and that makes a CANCELLED row *active* rather
 * than zeroing the pointer, landing on the branch above. It is kept because the
 * cost is one boolean and the failure it guards against is telling someone their
 * countersignature never happened. `test/integration/invoice-countersign-gate.spec.ts`
 * pins which of these are reachable, so a future transition that does zero the
 * pointer after a countersignature lands here rather than on the wrong message.
 */
export function invoiceBlockedReason(activeStatus: string | null | undefined, history: { hasAnyVersion: boolean; everCountersigned: boolean }): string | null {
  if (activeStatus === 'FINAL') return null;

  if (activeStatus === 'CANCELLED') {
    return 'This Statement of Work has been cancelled, so there is nothing to invoice against. Issue a new one first.';
  }
  if (activeStatus === 'SENT' || activeStatus === 'SIGNED') {
    return 'This Statement of Work has not been countersigned yet. Countersign it before invoicing, so the invoice bills the figures both parties agreed.';
  }

  // No version in force. Which of the two ways that happens changes the answer.
  if (history.everCountersigned) {
    return 'This Statement of Work was countersigned but has since been withdrawn, so no version is in force. Send and countersign it again before invoicing.';
  }
  if (!history.hasAnyVersion) {
    return 'This Statement of Work predates document versioning and has no version to bill against. It needs the one-off SOW migration before it can be countersigned or invoiced.';
  }
  return 'This Statement of Work has not been sent to the customer or countersigned. Invoicing bills the figures they agreed to, so there is nothing to bill against yet.';
}
