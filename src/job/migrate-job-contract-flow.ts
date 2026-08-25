import mongoose from 'mongoose';
import { ContractFingerprintWorkflowInput, contractFingerprint } from './contract-fingerprint.util';
import { CustomerActionRequired, JobState } from './job.model';
import { SOWStatus } from '../sow/sow.model';

/**
 * Brings jobs and SOWs written before the explicit-contract review flow up to
 * what the runtime gate now requires.
 *
 * Two separate jobs of work:
 *
 *  1. `customerActionRequired` — CHANGES_REQUESTED used to mean three different
 *     asks, told apart by sniffing `customerEditingEnabled` and the note on the
 *     last history event. Without this classification a customer holding such a
 *     job cannot respond at all: `respondToJobReview` refuses a job with no
 *     recorded action.
 *
 *  2. The exact acceptance — `acceptedJobVersionNumber` and
 *     `acceptedContractFingerprint`. The old `stampAcceptance` wrote only
 *     `acceptedBillingFingerprint`, and `contractBlockers` now demands all
 *     three, so every in-flight ACCEPTED job would report NOT_ACCEPTED and
 *     neither send nor sign its SOW.
 *
 * Safe to run before the new backend is live: everything written here is either
 * a field the old code never reads, or (see `staleEditingGrantsDisabled` and
 * the publication of the accepted version) a correction the old code would have
 * made itself. Safe to re-run — every write is guarded on the target value
 * actually differing, so a second pass reports `writes: 0`.
 */
export interface JobContractFlowMigrationReport {
  scannedJobs: number;
  classifiedEditWorkflow: number;
  classifiedApproveWorkflow: number;
  classifiedReply: number;
  classifiedNoAction: number;
  preservedValidActions: number;
  staleEditingGrantsDisabled: number;
  /** Accepted jobs that arrived without an exact acceptance recorded — the population this migration exists to repair. */
  acceptedJobsMissingExactAcceptance: number;
  acceptedJobsBackfilled: number;
  /** Which rule picked the accepted version, so a reader can tell a dated match from a fallback. */
  acceptedByAcceptedAt: number;
  acceptedByAcceptanceEvent: number;
  acceptedByLatestContent: number;
  /** Cannot be completed here: the gate needs a billing fingerprint, and computing one needs live pricing. Staff must re-accept. */
  acceptedJobsMissingBillingFingerprint: number;
  /** No content version exists to point at. Staff must re-accept, which synthesizes v1. */
  acceptedJobsWithNoContentVersion: number;
  acceptedVersionsPublished: number;
  currentOrActiveSowVersionsMissingSource: number;
  sowVersionsSourceBackfilled: number;
  sowVersionsStillMissingSource: number;
  historicalSignedOrFinalVersionsMissingSource: number;
  /** Job ids that could not be completed, with the reason. Drives a non-zero exit code. */
  failed: string[];
  writes: number;
}

const VALID_ACTIONS = new Set<string>(Object.values(CustomerActionRequired));

function sourceLinkMissing(version: any): boolean {
  return typeof version?.sourceJobVersionNumber !== 'number' || typeof version?.sourceContractFingerprint !== 'string' || version.sourceContractFingerprint.length === 0;
}

function hasExactAcceptance(job: any): boolean {
  return typeof job?.acceptedJobVersionNumber === 'number' && typeof job?.acceptedContractFingerprint === 'string' && job.acceptedContractFingerprint.length > 0;
}

function toTime(value: unknown): number | null {
  if (!value) return null;
  const time = new Date(value as any).getTime();
  return Number.isFinite(time) ? time : null;
}

interface AcceptedPick {
  version: any;
  rule: 'acceptedAt' | 'acceptanceEvent' | 'latestContent';
}

/**
 * Which immutable content version staff actually accepted.
 *
 * `acceptedAt` is the honest answer where it exists: the accepted spec is the
 * newest content version that already existed when acceptance was stamped.
 * Legacy rows predating that stamp fall back to the acceptance event's position
 * in the history, and failing that to the latest content version.
 *
 * The pick is recorded whether or not the job has since moved on. If it has,
 * the runtime gate reports JOB_CHANGED_SINCE_ACCEPTANCE — which is exactly what
 * the old billing-fingerprint comparison did, so both branches preserve the
 * behaviour this migration replaces.
 */
function pickAcceptedVersion(job: any, contentVersions: any[], latestAcceptanceEvent: any | undefined): AcceptedPick | null {
  if (contentVersions.length === 0) return null;

  const acceptedAt = toTime(job.acceptedAt);
  if (acceptedAt != null) {
    const atOrBefore = contentVersions.filter((version) => {
      const createdAt = toTime(version.createdAt);
      return createdAt != null && createdAt <= acceptedAt;
    });
    if (atOrBefore.length > 0) return { version: atOrBefore[0], rule: 'acceptedAt' };
  }

  const eventNumber = Number(latestAcceptanceEvent?.versionNumber);
  if (Number.isFinite(eventNumber)) {
    const below = contentVersions.filter((version) => Number(version.versionNumber) <= eventNumber);
    if (below.length > 0) return { version: below[0], rule: 'acceptanceEvent' };
  }

  return { version: contentVersions[0], rule: 'latestContent' };
}

export async function migrateJobContractFlow(db: mongoose.mongo.Db, opts: { dryRun?: boolean } = {}): Promise<JobContractFlowMigrationReport> {
  const jobsCollection = db.collection('jobs');
  const jobVersionsCollection = db.collection('job_versions');
  const sowVersionsCollection = db.collection('sow_versions');
  const [jobs, jobVersions, sows, sowVersions] = await Promise.all([
    jobsCollection.find({}).toArray(),
    jobVersionsCollection.find({}).toArray(),
    db.collection('sows').find({}).toArray(),
    sowVersionsCollection.find({}).toArray()
  ]);

  const latestEventByJob = new Map<string, any>();
  const latestAcceptanceEventByJob = new Map<string, any>();
  const contentVersionsByJob = new Map<string, any[]>();
  for (const version of jobVersions) {
    const jobId = String(version.jobId ?? '');
    if (version.isEvent !== true) {
      const bucket = contentVersionsByJob.get(jobId) ?? [];
      bucket.push(version);
      contentVersionsByJob.set(jobId, bucket);
      continue;
    }
    const previous = latestEventByJob.get(jobId);
    if (!previous || Number(version.versionNumber) > Number(previous.versionNumber)) latestEventByJob.set(jobId, version);
    if (version.jobState === JobState.ACCEPTED) {
      const previousAcceptance = latestAcceptanceEventByJob.get(jobId);
      if (!previousAcceptance || Number(version.versionNumber) > Number(previousAcceptance.versionNumber)) latestAcceptanceEventByJob.set(jobId, version);
    }
  }
  // Newest first, so "the newest at or below X" is the first survivor of a filter.
  for (const bucket of contentVersionsByJob.values()) bucket.sort((a, b) => Number(b.versionNumber) - Number(a.versionNumber));

  const report: JobContractFlowMigrationReport = {
    scannedJobs: jobs.length,
    classifiedEditWorkflow: 0,
    classifiedApproveWorkflow: 0,
    classifiedReply: 0,
    classifiedNoAction: 0,
    preservedValidActions: 0,
    staleEditingGrantsDisabled: 0,
    acceptedJobsMissingExactAcceptance: 0,
    acceptedJobsBackfilled: 0,
    acceptedByAcceptedAt: 0,
    acceptedByAcceptanceEvent: 0,
    acceptedByLatestContent: 0,
    acceptedJobsMissingBillingFingerprint: 0,
    acceptedJobsWithNoContentVersion: 0,
    acceptedVersionsPublished: 0,
    currentOrActiveSowVersionsMissingSource: 0,
    sowVersionsSourceBackfilled: 0,
    sowVersionsStillMissingSource: 0,
    historicalSignedOrFinalVersionsMissingSource: 0,
    failed: [],
    writes: 0
  };
  const jobUpdates: any[] = [];
  const jobVersionUpdates: any[] = [];
  const sowVersionUpdates: any[] = [];
  /** Acceptance stamped in this pass (or already present), keyed by job id — what the SOW source backfill reads. */
  const acceptanceByJob = new Map<string, { versionNumber: number; fingerprint: string }>();

  for (const job of jobs) {
    const jobId = String(job._id);
    const patch: Record<string, unknown> = {};

    // ---- 1. The exact acceptance ------------------------------------------
    if (job.state === JobState.ACCEPTED) {
      if (hasExactAcceptance(job)) {
        // Accepted through the new flow already. Never overwrite: this is the
        // record of what staff agreed to, not something to recompute.
        acceptanceByJob.set(jobId, { versionNumber: job.acceptedJobVersionNumber, fingerprint: job.acceptedContractFingerprint });
      } else {
        report.acceptedJobsMissingExactAcceptance += 1;
        const billingFingerprint = typeof job.acceptedBillingFingerprint === 'string' && job.acceptedBillingFingerprint.length > 0;
        const pick = pickAcceptedVersion(job, contentVersionsByJob.get(jobId) ?? [], latestAcceptanceEventByJob.get(jobId));

        if (!pick) {
          // Nothing to point at. Staff re-accept, which forces the lazy v1
          // backfill and stamps a real acceptance.
          report.acceptedJobsWithNoContentVersion += 1;
          report.failed.push(`${jobId}: accepted with no content version; staff must re-accept`);
        } else if (!billingFingerprint) {
          // The gate needs all three fields and a billing fingerprint needs live
          // service pricing, which this raw-collection migration cannot compute.
          // These jobs already reported NOT_ACCEPTED under the old gate, so
          // leaving them is not a regression.
          report.acceptedJobsMissingBillingFingerprint += 1;
          report.failed.push(`${jobId}: accepted with no billing fingerprint; staff must re-accept`);
        } else {
          let fingerprint: string;
          try {
            fingerprint = contractFingerprint({
              customerCategory: job.customerCategory,
              workflows: (pick.version.workflows ?? []) as ContractFingerprintWorkflowInput[]
            });
          } catch (error: any) {
            report.failed.push(`${jobId}: could not fingerprint v${pick.version.versionNumber}: ${error?.message ?? error}`);
            continue;
          }

          patch.acceptedJobVersionNumber = pick.version.versionNumber;
          patch.acceptedContractFingerprint = fingerprint;
          report.acceptedJobsBackfilled += 1;
          if (pick.rule === 'acceptedAt') report.acceptedByAcceptedAt += 1;
          else if (pick.rule === 'acceptanceEvent') report.acceptedByAcceptanceEvent += 1;
          else report.acceptedByLatestContent += 1;
          acceptanceByJob.set(jobId, { versionNumber: pick.version.versionNumber, fingerprint });

          // The gate requires the accepted source to be visible to the customer.
          // Staff-authored versions stay hidden until published, and acceptance
          // is what publishes them — see JobVersionService.publishVersion.
          if (pick.version.authorRole === 'STAFF' && pick.version.visibleToCustomer === false) {
            report.acceptedVersionsPublished += 1;
            jobVersionUpdates.push({
              updateOne: {
                filter: { _id: pick.version._id },
                update: {
                  $set: {
                    visibleToCustomer: true,
                    publishedAt: job.acceptedAt ?? new Date(),
                    publishedBy: job.acceptedBy ?? 'migration'
                  }
                }
              }
            });
          }
        }
      }
    }

    // ---- 2. The requested customer action ---------------------------------
    const validAction = VALID_ACTIONS.has(job.customerActionRequired);
    if (validAction) {
      report.preservedValidActions += 1;
    } else if (job.state === JobState.CHANGES_REQUESTED) {
      let action: CustomerActionRequired;
      if (job.customerEditingEnabled === true) {
        action = CustomerActionRequired.EDIT_WORKFLOW;
        report.classifiedEditWorkflow += 1;
      } else if (latestEventByJob.get(jobId)?.note === 'Approval requested') {
        action = CustomerActionRequired.APPROVE_WORKFLOW;
        report.classifiedApproveWorkflow += 1;
      } else {
        action = CustomerActionRequired.REPLY;
        report.classifiedReply += 1;
      }
      if (job.customerActionRequired !== action) patch.customerActionRequired = action;
    } else {
      report.classifiedNoAction += 1;
      if (job.customerActionRequired !== null) patch.customerActionRequired = null;
    }

    if (job.state !== JobState.CHANGES_REQUESTED && job.customerEditingEnabled === true) {
      report.staleEditingGrantsDisabled += 1;
      patch.customerEditingEnabled = false;
    }

    if (Object.keys(patch).length > 0) {
      jobUpdates.push({ updateOne: { filter: { _id: job._id }, update: { $set: patch } } });
    }
  }

  // ---- 3. SOW document provenance -----------------------------------------
  // Only the rows the parent pointers name are ever gated: contractBlockers is
  // evaluated against the current version for a send and the active version for
  // a sign or countersign. Historical rows are audited below but not written.
  const versionBySowAndNumber = new Map(sowVersions.map((version) => [`${String(version.sowId)}:${version.versionNumber}`, version]));
  const auditedLifecycleVersions = new Set<string>();
  for (const sow of sows) {
    const acceptance = acceptanceByJob.get(String(sow.jobId));
    for (const versionNumber of [sow.currentVersionNumber, sow.activeVersionNumber]) {
      if (typeof versionNumber !== 'number' || versionNumber === 0) continue;
      const key = `${String(sow._id)}:${versionNumber}`;
      if (auditedLifecycleVersions.has(key)) continue;
      auditedLifecycleVersions.add(key);

      const version = versionBySowAndNumber.get(key);
      const isLifecycleStage = [SOWStatus.DRAFT, SOWStatus.SENT].includes(sow.status);
      if (isLifecycleStage && (!version || sourceLinkMissing(version))) report.currentOrActiveSowVersionsMissingSource += 1;
      if (!version || !sourceLinkMissing(version)) continue;

      if (!acceptance) {
        // Nothing authoritative to point the document at. SOW_SOURCE_MISMATCH
        // only fires on a recorded source, so this stays as it was: the job's
        // own blockers still gate it.
        report.sowVersionsStillMissingSource += 1;
        continue;
      }

      report.sowVersionsSourceBackfilled += 1;
      sowVersionUpdates.push({
        updateOne: {
          filter: { _id: version._id },
          update: { $set: { sourceJobVersionNumber: acceptance.versionNumber, sourceContractFingerprint: acceptance.fingerprint } }
        }
      });
    }
  }

  report.historicalSignedOrFinalVersionsMissingSource = sowVersions.filter((version) => [SOWStatus.SIGNED, SOWStatus.FINAL].includes(version.status as SOWStatus) && sourceLinkMissing(version)).length;
  report.writes = jobUpdates.length + jobVersionUpdates.length + sowVersionUpdates.length;

  if (!opts.dryRun) {
    if (jobUpdates.length > 0) await jobsCollection.bulkWrite(jobUpdates);
    if (jobVersionUpdates.length > 0) await jobVersionsCollection.bulkWrite(jobVersionUpdates);
    if (sowVersionUpdates.length > 0) await sowVersionsCollection.bulkWrite(sowVersionUpdates);
  }
  return report;
}

export interface JobContractFlowVerifyReport {
  acceptedJobsMissingExactAcceptance: string[];
  acceptedJobsMissingBillingFingerprint: string[];
  changesRequestedJobsWithNoAction: string[];
  lifecycleSowVersionsMissingSource: string[];
  blocked: number;
}

/**
 * Read-only re-evaluation of the predicates the runtime gate applies, naming
 * every row that would be blocked.
 *
 * This is what stands in for a rehearsal against restored production data: run
 * it before the migration to size the problem, and again afterwards to confirm
 * the residue is only the population that genuinely needs staff to re-accept.
 */
export async function verifyJobContractFlow(db: mongoose.mongo.Db): Promise<JobContractFlowVerifyReport> {
  const [jobs, sows, sowVersions] = await Promise.all([db.collection('jobs').find({}).toArray(), db.collection('sows').find({}).toArray(), db.collection('sow_versions').find({}).toArray()]);

  const report: JobContractFlowVerifyReport = {
    acceptedJobsMissingExactAcceptance: [],
    acceptedJobsMissingBillingFingerprint: [],
    changesRequestedJobsWithNoAction: [],
    lifecycleSowVersionsMissingSource: [],
    blocked: 0
  };

  for (const job of jobs) {
    const jobId = String(job._id);
    if (job.state === JobState.ACCEPTED) {
      if (!hasExactAcceptance(job)) report.acceptedJobsMissingExactAcceptance.push(jobId);
      if (typeof job.acceptedBillingFingerprint !== 'string' || job.acceptedBillingFingerprint.length === 0) report.acceptedJobsMissingBillingFingerprint.push(jobId);
    }
    // These customers cannot respond at all: respondToJobReview refuses a job
    // with no recorded action.
    if (job.state === JobState.CHANGES_REQUESTED && !VALID_ACTIONS.has(job.customerActionRequired)) report.changesRequestedJobsWithNoAction.push(jobId);
  }

  const versionBySowAndNumber = new Map(sowVersions.map((version) => [`${String(version.sowId)}:${version.versionNumber}`, version]));
  for (const sow of sows) {
    if (![SOWStatus.DRAFT, SOWStatus.SENT].includes(sow.status)) continue;
    for (const versionNumber of [sow.currentVersionNumber, sow.activeVersionNumber]) {
      if (typeof versionNumber !== 'number' || versionNumber === 0) continue;
      const key = `${String(sow._id)}:${versionNumber}`;
      const version = versionBySowAndNumber.get(key);
      if ((!version || sourceLinkMissing(version)) && !report.lifecycleSowVersionsMissingSource.includes(key)) report.lifecycleSowVersionsMissingSource.push(key);
    }
  }

  report.blocked =
    report.acceptedJobsMissingExactAcceptance.length +
    report.acceptedJobsMissingBillingFingerprint.length +
    report.changesRequestedJobsWithNoAction.length +
    report.lifecycleSowVersionsMissingSource.length;
  return report;
}

export async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry') || process.argv.includes('--dry-run');
  const verifyOnly = process.argv.includes('--verify');
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set. Run with: node --env-file=.env dist/job/migrate-job-contract-flow.js');

  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database handle after connect');

    if (verifyOnly) {
      const verification = await verifyJobContractFlow(db);
      console.log('Verification only — no writes were made.');
      console.log(JSON.stringify(verification, null, 2));
      if (verification.blocked > 0) console.warn(`${verification.blocked} record(s) would be blocked by the contract gate.`);
      return;
    }

    const report = await migrateJobContractFlow(db, { dryRun });
    console.log(dryRun ? 'Dry run — no writes were made.' : 'Job contract flow migration applied.');
    console.log(JSON.stringify(report, null, 2));
    if (report.failed.length > 0) {
      console.error(`${report.failed.length} job(s) could not be completed and need staff to re-accept them:`);
      for (const failure of report.failed) console.error(`  - ${failure}`);
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
