import { HomologyScreeningStatus } from './job.model';
import { customerVerificationState } from '../aclid/aclid-status.util';

/**
 * A plain copy. Mongoose documents get `toObject()` so redacting the copy
 * cannot mark the stored job dirty. Plain objects (tests, lean results) are
 * shallow-copied; the screening blobs are replaced, not edited in place.
 */
export function cloneJob<T>(job: T): T {
  const anyJob = job as { toObject?: () => T };
  if (typeof anyJob?.toObject === 'function') return anyJob.toObject();
  return { ...(job as object) } as T;
}

/**
 * Apply a redacted view.
 *
 * A Mongoose document stays a document — `ownJobById` field resolvers walk
 * `workflows` as stored ids — and the edit is unmarked so a later save cannot
 * persist the redaction. Plain objects get a copy.
 */
export function redactJobBiosecurity<T>(job: T, mode: 'hidden' | 'customer'): T {
  const view = mode === 'hidden' ? withoutBiosecurity(job) : customerBiosecurityView(job);
  const doc = job as {
    set?: (path: string, value: unknown) => void;
    unmarkModified?: (path: string) => void;
  };
  if (typeof doc?.set !== 'function' || typeof doc?.unmarkModified !== 'function') {
    return view;
  }
  const screened = view as {
    homologyScreening?: unknown;
    aclidScreening?: unknown;
    screeningBatchIds?: unknown;
  };
  doc.set('homologyScreening', screened.homologyScreening ?? null);
  doc.set('aclidScreening', screened.aclidScreening ?? null);
  doc.set('screeningBatchIds', screened.screeningBatchIds ?? []);
  doc.unmarkModified('homologyScreening');
  doc.unmarkModified('aclidScreening');
  doc.unmarkModified('screeningBatchIds');
  return job;
}

/** Drop every screening field. Used when this account may not see the block. */
export function withoutBiosecurity<T>(job: T): T {
  const copy = cloneJob(job) as T & {
    homologyScreening?: unknown;
    aclidScreening?: unknown;
    screeningBatchIds?: unknown;
  };
  delete copy.homologyScreening;
  delete copy.aclidScreening;
  delete copy.screeningBatchIds;
  return copy;
}

/**
 * The customer job page. Keeps enough to offer the verification button and say
 * whether it has been submitted. Homology, the regulatory verdict, and the
 * approve/reject decision are removed.
 */
export function customerBiosecurityView<T>(job: T): T {
  const copy = withoutBiosecurity(job) as T & {
    aclidScreening?: {
      screenId?: string | null;
      verificationStatus?: string | null;
      verificationCompletedAt?: Date | string | null;
      decisionStatus?: string | null;
      homologyStatus?: string;
      customerStatus?: string;
      sequenceCount?: number;
      startedAt?: Date;
    };
  };
  const screening = (job as { aclidScreening?: typeof copy.aclidScreening }).aclidScreening;
  const state = customerVerificationState(screening);
  if (!screening?.screenId || state === 'unavailable') return copy;
  copy.aclidScreening = {
    screenId: screening.screenId,
    verificationStatus: state,
    verificationCompletedAt: state === 'submitted' ? screening.verificationCompletedAt ?? null : null,
    homologyStatus: HomologyScreeningStatus.UNAVAILABLE,
    customerStatus: HomologyScreeningStatus.UNAVAILABLE,
    sequenceCount: 0,
    startedAt: screening.startedAt
  };
  return copy;
}
