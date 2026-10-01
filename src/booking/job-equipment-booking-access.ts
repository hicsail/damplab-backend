import { registerEnumType } from '@nestjs/graphql';
import { isJobMember } from '../job/job-membership';

/**
 * Whether this caller may book equipment against this job, and why not when they
 * cannot.
 *
 * Deliberately pure over its inputs — the caller loads the job, the SOW status and
 * the job's equipment-use operations, this decides. That is what makes the whole
 * eligibility table testable without a database, and it is the one definition both
 * the query and the three mutations consult.
 */
export enum JobBookingAccessStatus {
  OPEN = 'OPEN',
  SOW_NOT_SIGNED = 'SOW_NOT_SIGNED',
  BLOCKED = 'BLOCKED',
  NOT_ELIGIBLE = 'NOT_ELIGIBLE',
  HIDDEN = 'HIDDEN'
}
registerEnumType(JobBookingAccessStatus, { name: 'JobBookingAccessStatus' });

export interface AccessJob {
  sub?: string;
  email?: string;
  clientEmail?: string;
  memberEmails?: string[];
  bookingBlocked?: boolean;
  bookingBlockedReason?: string;
}

export interface AccessActor {
  sub?: string;
  email?: string;
  hasInventoryBook: boolean;
  hasJobsViewAll: boolean;
  hasBillingView: boolean;
}

/** One equipment-use operation of the job. Eligibility is per job, not per operation. */
export interface AccessOperation {
  nodeId: string;
}

export interface JobBookingAccessVerdict {
  status: JobBookingAccessStatus;
  canBook: boolean;
  canBlock: boolean;
  reason?: string;
  /** Node ids this actor may book. Empty for every read-only verdict. */
  bookableNodeIds: string[];
}

const HIDDEN: JobBookingAccessVerdict = {
  status: JobBookingAccessStatus.HIDDEN,
  canBook: false,
  canBlock: false,
  bookableNodeIds: []
};

export function resolveJobEquipmentBookingAccess(job: AccessJob, actor: AccessActor, operations: AccessOperation[], sowSigned: boolean): JobBookingAccessVerdict {
  // Staff read every job, and read it honestly: they get the same status an
  // eligible customer would, with every control off. `billing:view` is the one
  // thing they can do here, and it is pause/unpause.
  if (actor.hasJobsViewAll) {
    const status = !sowSigned ? JobBookingAccessStatus.SOW_NOT_SIGNED : job.bookingBlocked ? JobBookingAccessStatus.BLOCKED : JobBookingAccessStatus.OPEN;
    return {
      status,
      canBook: false,
      canBlock: actor.hasBillingView,
      reason: status === JobBookingAccessStatus.BLOCKED ? job.bookingBlockedReason : undefined,
      bookableNodeIds: []
    };
  }

  // Booking follows job membership alone: the primary or a member added with
  // Manage. The old per-operation "Authorized booker emails" list is retired;
  // a stored value on an old node is ignored here.
  const isOnJob = isJobMember(job, actor);

  // HIDDEN first, and it returns nothing else: a stranger must not learn from the
  // status whether this job exists, whether its SOW is signed, or that the lab has
  // paused it.
  if (!isOnJob) return HIDDEN;

  // Being on the job does not grant the lab's equipment-user tier.
  if (!actor.hasInventoryBook) {
    return { status: JobBookingAccessStatus.NOT_ELIGIBLE, canBook: false, canBlock: false, bookableNodeIds: [] };
  }

  if (!sowSigned) {
    return { status: JobBookingAccessStatus.SOW_NOT_SIGNED, canBook: false, canBlock: false, bookableNodeIds: [] };
  }

  if (job.bookingBlocked) {
    return {
      status: JobBookingAccessStatus.BLOCKED,
      canBook: false,
      canBlock: false,
      reason: job.bookingBlockedReason,
      bookableNodeIds: []
    };
  }

  const bookableNodeIds = operations.map((op) => op.nodeId);
  return { status: JobBookingAccessStatus.OPEN, canBook: bookableNodeIds.length > 0, canBlock: false, bookableNodeIds };
}
