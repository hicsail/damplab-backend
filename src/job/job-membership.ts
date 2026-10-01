import { BadRequestException } from '@nestjs/common';
import * as mongoose from 'mongoose';
import { effectiveClientEmailExpr, normalizeClientEmail } from './client-email';

/**
 * Who is *on* a job. One predicate for every read and write a non-staff caller
 * makes, so a client staff submitted for, or a member added later, has exactly
 * the powers the submitter has (design: "full parity").
 */
export interface JobMembershipSubject {
  sub?: string | null;
  email?: string | null;
  clientEmail?: string | null;
  memberEmails?: readonly string[] | null;
}

export interface JobMembershipActor {
  sub?: string | null;
  email?: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string | null | undefined): boolean {
  const normalized = normalizeClientEmail(email);
  return !!normalized && EMAIL_PATTERN.test(normalized);
}

/** `clientEmail ?? email`, normalized. The one address that can never be removed. */
export function jobPrimaryEmail(job: JobMembershipSubject | null | undefined): string | undefined {
  return normalizeClientEmail(job?.clientEmail) ?? normalizeClientEmail(job?.email);
}

/** The additional people: normalized, deduped, never the primary. */
export function jobMemberEmails(job: JobMembershipSubject | null | undefined): string[] {
  const primary = jobPrimaryEmail(job);
  const out: string[] = [];
  for (const raw of job?.memberEmails ?? []) {
    const normalized = normalizeClientEmail(raw);
    if (normalized && normalized !== primary && !out.includes(normalized)) out.push(normalized);
  }
  return out;
}

export function isJobMember(job: JobMembershipSubject | null | undefined, user: JobMembershipActor | null | undefined): boolean {
  if (!job || !user) return false;
  if (job.sub && user.sub && job.sub === user.sub) return true;
  const email = normalizeClientEmail(user.email);
  if (!email) return false;
  if (jobPrimaryEmail(job) === email) return true;
  return jobMemberEmails(job).includes(email);
}

/**
 * The Mongo twin of `isJobMember`, for the list queries. Replaces
 * `ownedJobsFilter`. The primary side reuses `effectiveClientEmailExpr` so
 * legacy rows stored before emails were normalized still match; `memberEmails`
 * is only ever written normalized, so a plain equality is enough there.
 */
export function jobMembersFilter(sub: string, email: string | null | undefined): mongoose.FilterQuery<any> {
  const normalized = normalizeClientEmail(email);
  if (!normalized) return { sub };
  return { $or: [{ sub }, { $expr: { $eq: [effectiveClientEmailExpr(), normalized] } }, { memberEmails: normalized }] };
}

/** Checkout's member list: normalized, deduped, primary dropped, malformed refused. */
export function normalizeMemberEmailList(emails: readonly string[] | null | undefined, primaryEmail: string | null | undefined): string[] {
  const primary = normalizeClientEmail(primaryEmail);
  const out: string[] = [];
  for (const raw of emails ?? []) {
    const normalized = normalizeClientEmail(raw);
    if (!normalized) continue;
    if (!EMAIL_PATTERN.test(normalized)) throw new BadRequestException(`"${raw.trim()}" is not a valid email address.`);
    if (normalized === primary || out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}
