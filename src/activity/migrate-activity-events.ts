import mongoose from 'mongoose';

/**
 * Backfill activity events for existing jobs.
 *
 * The activity event system now tracks all job lifecycle events going forward,
 * but jobs created before the feature was deployed have no documents in the
 * `activity_events` collection. This migration reconstructs historical events
 * from job versions, SOW versions, comments, and invoices so the per-job
 * timeline drawer shows a complete history from day one.
 *
 * Safe to re-run: every event gets a deterministic `operationId`, and the
 * unique partial index on that field makes duplicate inserts fail gracefully.
 *
 * Usage:
 *   node dist/activity/migrate-activity-events.js --verify   # read-only: which jobs have no events
 *   node dist/activity/migrate-activity-events.js --dry      # read-only: what would be written
 *   node dist/activity/migrate-activity-events.js            # apply
 */

// ── JobState numeric enum (mirrors src/job/job.model.ts) ──
const JOB_STATE_NAMES: Record<number, string> = {
  0: 'CREATING',
  1: 'SUBMITTED',
  2: 'CHANGES_REQUESTED',
  3: 'ACCEPTED',
  4: 'WAITING_FOR_SOW',
  5: 'QUEUED',
  6: 'IN_PROGRESS',
  7: 'COMPLETE',
  8: 'REJECTED',
  9: 'CLOSED',
  10: 'CANCELLED'
};

// ── Types ──

interface BackfillEvent {
  createdAt: Date;
  type: string;
  message: string;
  operationId: string;
  actorDisplayName?: string;
  jobId?: string;
  jobVersionNumber?: number;
  sowId?: string;
  sowVersionNumber?: number;
  invoiceId?: string;
  invoiceNumber?: string;
  commentId?: string;
}

interface MigrationReport {
  scannedJobs: number;
  fromJobVersions: number;
  fromJobFields: number;
  fromSowVersions: number;
  fromComments: number;
  fromInvoices: number;
  eventsCreated: number;
  eventsSkippedDuplicate: number;
  failed: string[];
  writes: number;
}

// ── Event classification ──

function classifyStateEvent(jobState: number | undefined, note: string | undefined): string {
  const stateName = typeof jobState === 'number' ? JOB_STATE_NAMES[jobState] : undefined;
  const lowerNote = (note ?? '').toLowerCase();

  if (stateName === 'SUBMITTED') {
    return lowerNote.includes('resubmit') ? 'JOB_SUBMITTED' : 'JOB_SUBMITTED';
  }
  if (stateName === 'CHANGES_REQUESTED') return 'JOB_REVIEWED';
  if (stateName === 'ACCEPTED') return 'JOB_REVIEWED';
  if (stateName === 'CLOSED') return 'JOB_CLOSED';
  if (stateName === 'CANCELLED') return 'JOB_CANCELLED';
  if (stateName === 'REJECTED') return 'JOB_REJECTED';
  return 'JOB_STATE_CHANGED';
}

function stateEventMessage(jobState: number | undefined, note: string | undefined, jobName: string): string {
  const stateName = typeof jobState === 'number' ? JOB_STATE_NAMES[jobState] : 'Unknown';
  if (note?.trim()) return note.trim();
  switch (stateName) {
    case 'SUBMITTED':
      return `Job "${jobName}" was submitted`;
    case 'CHANGES_REQUESTED':
      return `Job review decision: Request changes`;
    case 'ACCEPTED':
      return `Job review decision: Accepted`;
    case 'CLOSED':
      return `Job "${jobName}" closed`;
    case 'CANCELLED':
      return `Job "${jobName}" cancelled`;
    case 'REJECTED':
      return `Job "${jobName}" rejected`;
    default:
      return `Job "${jobName}" state changed to ${stateName}`;
  }
}

// ── Core migration ──

export async function migrateActivityEvents(db: mongoose.Connection['db'], options: { dryRun: boolean }): Promise<MigrationReport> {
  if (!db) throw new Error('No database handle');

  const jobs = db.collection('jobs');
  const jobVersions = db.collection('job_versions');
  const sows = db.collection('sows');
  const sowVersions = db.collection('sow_versions');
  const comments = db.collection('comments');
  const invoices = db.collection('invoices');
  const activityEvents = db.collection('activity_events');

  const report: MigrationReport = {
    scannedJobs: 0,
    fromJobVersions: 0,
    fromJobFields: 0,
    fromSowVersions: 0,
    fromComments: 0,
    fromInvoices: 0,
    eventsCreated: 0,
    eventsSkippedDuplicate: 0,
    failed: [],
    writes: 0
  };

  const allJobs = await jobs.find({}).toArray();
  report.scannedJobs = allJobs.length;
  console.log(`Scanning ${allJobs.length} jobs...`);

  for (const job of allJobs) {
    const jobId = String(job._id);
    const jobName = job.name ?? 'Untitled';
    const events: BackfillEvent[] = [];

    try {
      // ── 1. Job versions ──
      const versions = await jobVersions.find({ jobId }).sort({ versionNumber: 1 }).toArray();

      let hasSubmittedEvent = false;
      let hasClosedEvent = false;
      let hasCancelledEvent = false;

      for (const v of versions) {
        const actor = v.createdByName || undefined;
        const vNum = v.versionNumber as number;

        if (vNum === 1) {
          // Version 1 is always the original submission
          hasSubmittedEvent = true;
          events.push({
            createdAt: v.createdAt ? new Date(v.createdAt) : new Date(job.submitted ?? Date.now()),
            type: 'JOB_SUBMITTED',
            message: `Job "${jobName}" was submitted`,
            actorDisplayName: actor,
            jobId,
            jobVersionNumber: vNum,
            operationId: `BACKFILL:JOB_EVENT:${jobId}:${vNum}`
          });
          report.fromJobVersions++;
        } else if (v.isEvent) {
          // State change event
          const type = classifyStateEvent(v.jobState, v.note);
          const message = stateEventMessage(v.jobState, v.note, jobName);
          if (type === 'JOB_SUBMITTED') hasSubmittedEvent = true;
          if (type === 'JOB_CLOSED') hasClosedEvent = true;
          if (type === 'JOB_CANCELLED') hasCancelledEvent = true;
          events.push({
            createdAt: new Date(v.createdAt),
            type,
            message,
            actorDisplayName: actor,
            jobId,
            jobVersionNumber: vNum,
            operationId: `BACKFILL:JOB_EVENT:${jobId}:${vNum}`
          });
          report.fromJobVersions++;
        } else {
          // Workflow graph edit
          const note = v.note?.trim();
          events.push({
            createdAt: new Date(v.createdAt),
            type: 'JOB_WORKFLOWS_EDITED',
            message: `Workflows edited on job "${jobName}"${note ? `: ${note}` : ''}`,
            actorDisplayName: actor,
            jobId,
            jobVersionNumber: vNum,
            operationId: `BACKFILL:JOB_EDIT:${jobId}:${vNum}`
          });
          report.fromJobVersions++;
        }
      }

      // ── 2. Job-level fields (fill gaps) ──
      if (!hasSubmittedEvent && job.submitted) {
        events.push({
          createdAt: new Date(job.submitted),
          type: 'JOB_SUBMITTED',
          message: `Job "${jobName}" was submitted`,
          actorDisplayName: job.username ?? job.clientDisplayName ?? undefined,
          jobId,
          operationId: `BACKFILL:JOB_SUBMITTED:${jobId}`
        });
        report.fromJobFields++;
      }

      if (job.archivedAt) {
        events.push({
          createdAt: new Date(job.archivedAt),
          type: 'JOB_ARCHIVED',
          message: `Job "${jobName}" archived`,
          actorDisplayName: job.archivedBy ?? undefined,
          jobId,
          operationId: `BACKFILL:JOB_ARCHIVED:${jobId}`
        });
        report.fromJobFields++;
      }

      const currentState = typeof job.state === 'number' ? JOB_STATE_NAMES[job.state] : undefined;
      if (currentState === 'CLOSED' && !hasClosedEvent) {
        events.push({
          createdAt: new Date(job.updatedAt ?? job.submitted ?? Date.now()),
          type: 'JOB_CLOSED',
          message: `Job "${jobName}" closed`,
          jobId,
          operationId: `BACKFILL:JOB_CLOSED:${jobId}`
        });
        report.fromJobFields++;
      }
      if (currentState === 'CANCELLED' && !hasCancelledEvent) {
        events.push({
          createdAt: new Date(job.updatedAt ?? job.submitted ?? Date.now()),
          type: 'JOB_CANCELLED',
          message: `Job "${jobName}" cancelled`,
          jobId,
          operationId: `BACKFILL:JOB_CANCELLED:${jobId}`
        });
        report.fromJobFields++;
      }

      // ── 3. SOW versions (undelivered lifecycle events) ──
      const jobSow = await sows.findOne({ jobId });
      if (jobSow) {
        const sowId = String(jobSow._id);
        const sowLabel = jobSow.sowNumber || sowId;
        const undelivered = await sowVersions
          .find({
            sowId,
            activityEventType: { $exists: true, $ne: null },
            activityDeliveredAt: { $exists: false }
          })
          .toArray();

        for (const sv of undelivered) {
          const eventType = sv.activityEventType as string;
          const svNum = sv.versionNumber as number;
          let message: string;
          switch (eventType) {
            case 'SOW_SENT':
              message = `SOW "${sowLabel}" was sent to the customer`;
              break;
            case 'SOW_SIGNED':
              message = `SOW "${sowLabel}" was signed by the customer`;
              break;
            case 'SOW_FINALIZED':
              message = `SOW "${sowLabel}" was finalized`;
              break;
            default:
              message = `SOW "${sowLabel}" lifecycle changed`;
              break;
          }
          events.push({
            createdAt: new Date(sv.createdAt),
            type: eventType,
            message,
            actorDisplayName: sv.createdByName ?? undefined,
            jobId,
            sowId,
            sowVersionNumber: svNum,
            operationId: `BACKFILL:SOW:${sowId}:${svNum}`
          });
          report.fromSowVersions++;
        }
      }

      // ── 4. Comments ──
      const jobComments = await comments.find({ jobId }).sort({ createdAt: 1 }).toArray();
      for (const c of jobComments) {
        const authorType = c.authorType === 'STAFF' ? 'Technician' : 'Client';
        events.push({
          createdAt: new Date(c.createdAt),
          type: 'COMMENT_CREATED',
          message: `${authorType} added a comment`,
          actorDisplayName: c.author ?? undefined,
          jobId,
          commentId: String(c._id),
          operationId: `BACKFILL:COMMENT:${c._id}`
        });
        report.fromComments++;
      }

      // ── 5. Invoices ──
      const jobInvoices = await invoices.find({ jobId }).sort({ invoiceDate: 1 }).toArray();
      for (const inv of jobInvoices) {
        const invId = String(inv._id);
        const invNumber = inv.invoiceNumber ?? '';
        events.push({
          createdAt: new Date(inv.invoiceDate ?? inv.createdAt ?? Date.now()),
          type: 'INVOICE_GENERATED',
          message: `Invoice ${invNumber} generated`,
          actorDisplayName: inv.createdBy ?? undefined,
          jobId,
          invoiceId: invId,
          invoiceNumber: invNumber,
          operationId: `BACKFILL:INVOICE:${invId}`
        });
        report.fromInvoices++;

        if (inv.voidedAt) {
          events.push({
            createdAt: new Date(inv.voidedAt),
            type: 'INVOICE_VOIDED',
            message: `Invoice ${invNumber} voided`,
            actorDisplayName: inv.voidedBy ?? undefined,
            jobId,
            invoiceId: invId,
            invoiceNumber: invNumber,
            operationId: `BACKFILL:INVOICE_VOIDED:${invId}`
          });
          report.fromInvoices++;
        }
      }

      // ── Bulk insert ──
      if (events.length === 0) continue;

      if (options.dryRun) {
        report.eventsCreated += events.length;
        report.writes += events.length;
        continue;
      }

      try {
        const result = await activityEvents.insertMany(events, { ordered: false });
        const inserted = result.insertedCount;
        report.eventsCreated += inserted;
        report.writes += inserted;
        report.eventsSkippedDuplicate += events.length - inserted;
      } catch (error: any) {
        // BulkWriteError with duplicate key errors — count successes
        if (error?.code === 11000 || error?.writeErrors) {
          const dupes = (error.writeErrors ?? []).filter((e: any) => e.code === 11000).length;
          const inserted = events.length - dupes;
          report.eventsCreated += inserted;
          report.writes += inserted;
          report.eventsSkippedDuplicate += dupes;
        } else {
          report.failed.push(`${jobId}: ${error.message}`);
        }
      }
    } catch (error: any) {
      report.failed.push(`${jobId}: ${error.message}`);
    }
  }

  return report;
}

// ── Verify ──

export async function verifyActivityEvents(db: mongoose.Connection['db']): Promise<{ totalJobs: number; jobsWithEvents: number; jobsWithoutEvents: number; jobsMissing: string[] }> {
  if (!db) throw new Error('No database handle');

  const allJobs = await db
    .collection('jobs')
    .find({}, { projection: { _id: 1, name: 1 } })
    .toArray();
  const jobsWithEvents = new Set<string>();

  const eventJobIds = await db.collection('activity_events').distinct('jobId');
  for (const id of eventJobIds) {
    if (id) jobsWithEvents.add(String(id));
  }

  const jobsMissing: string[] = [];
  for (const job of allJobs) {
    if (!jobsWithEvents.has(String(job._id))) {
      jobsMissing.push(`${job._id} (${job.name ?? 'Untitled'})`);
    }
  }

  return {
    totalJobs: allJobs.length,
    jobsWithEvents: jobsWithEvents.size,
    jobsWithoutEvents: jobsMissing.length,
    jobsMissing
  };
}

// ── CLI entry point ──

export async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry') || process.argv.includes('--dry-run');
  const verifyOnly = process.argv.includes('--verify');
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set. Run with: node --env-file=.env dist/activity/migrate-activity-events.js');

  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database handle after connect');

    if (verifyOnly) {
      const result = await verifyActivityEvents(db);
      console.log('Verification only — no writes were made.');
      console.log(JSON.stringify(result, null, 2));
      if (result.jobsWithoutEvents > 0) {
        console.warn(`${result.jobsWithoutEvents} job(s) have no activity events.`);
      }
      return;
    }

    const report = await migrateActivityEvents(db, { dryRun });
    console.log(dryRun ? 'Dry run — no writes were made.' : 'Activity event backfill applied.');
    console.log(JSON.stringify(report, null, 2));
    if (report.failed.length > 0) {
      console.error(`${report.failed.length} job(s) failed:`);
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
