import { ForbiddenException } from '@nestjs/common';
import { Permission } from '../auth/permissions/permission.enum';
import { hasPermission } from '../auth/permissions/permissions';
import { User } from '../auth/user.interface';
import { matchesClientEmail } from './client-email';

/** The half of a job this rule reads. Deliberately not the whole document. */
export interface JobFinancialSubject {
  sub?: string;
  clientEmail?: string;
}

/**
 * Who may read a job's money: its balance, its payments.
 *
 * Staff read every job through `jobs:view-all` rather than through the raw
 * `damplab-staff` role, so a technician — who holds the permission and not the
 * role — is not silently 403'd on page load. The customer side is the same
 * pair `ownedJobsFilter` uses: the submitter's own `sub`, or the client email
 * a staff member typed when submitting on their behalf.
 *
 * Note this is NOT the rule `InvoiceResolver.invoicesByJobId` applies. That one
 * still gates on `Role.DamplabStaff` and admits a different set; reconciling
 * them is a permission change to an existing financial read and is out of scope
 * for this run.
 */
export function mayReadJobFinancials(job: JobFinancialSubject | null | undefined, user: User | null | undefined): boolean {
  if (!job) return false;
  if (hasPermission(user ?? undefined, Permission.JobsViewAll)) return true;
  if (job.sub && user?.sub && job.sub === user.sub) return true;
  return matchesClientEmail(job.clientEmail, user?.email);
}

/**
 * The refusal, worded so it does not confirm the job exists to someone who
 * cannot see it — the same reason `jobEquipmentBooking` answers HIDDEN.
 */
export function assertMayReadJobFinancials(job: JobFinancialSubject | null | undefined, user: User | null | undefined): void {
  if (!mayReadJobFinancials(job, user)) {
    throw new ForbiddenException('You do not have permission to view billing for this job.');
  }
}
