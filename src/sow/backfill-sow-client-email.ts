/**
 * One-shot data correction: point a SOW's clientEmail at the client, not at the
 * staff member who submitted the job for them.
 *
 * `createForJob` used to copy `job.email` into the SOW, and on a staff-submitted
 * job that address is the technician's — it comes from the submitter's token.
 * That is fixed going forward; this repairs the rows already written.
 *
 * Not an access fix. SOW reads authorize against the *job*, so nobody has been
 * locked out. What was wrong is what the document displays and what
 * `invoice.billedToEmail` copies out of it.
 *
 * Run with:
 *   npm run backfill:sow-client-email -- --dry   # report only
 *   npm run backfill:sow-client-email            # apply
 *
 * Idempotent, and conservative: a SOW whose clientEmail is neither the stale
 * submitter address nor already correct is assumed to have been edited by hand
 * and is left alone.
 */
import mongoose from 'mongoose';
import { normalizeClientEmail } from '../job/client-email';

export interface BackfillReport {
  scanned: number;
  corrected: number;
  skipped: number;
  /**
   * SOWs corrected whose parties block was already rendered into an issued
   * version. The stored text of an issued version is deliberately immutable —
   * a customer must keep seeing what they were sent — so these need a human to
   * decide whether the change is worth reissuing over.
   */
  needsReissue: Array<{ sowId: string; issuedVersions: number[] }>;
  orphaned: string[];
  failed: Array<{ id: string; error: string }>;
}

export async function backfillSowClientEmail(db: mongoose.mongo.Db, opts: { dryRun?: boolean; log?: (msg: string) => void } = {}): Promise<BackfillReport> {
  const log = opts.log ?? console.log;
  const sows = db.collection('sows');
  const jobs = db.collection('jobs');
  const versions = db.collection('sow_versions');

  const report: BackfillReport = { scanned: 0, corrected: 0, skipped: 0, needsReissue: [], orphaned: [], failed: [] };

  for (const sow of await sows.find({}).toArray()) {
    report.scanned += 1;
    const sowId = String(sow._id);

    try {
      const [job] = await jobs.find({ _id: toJobId(sow.jobId) }).toArray();
      if (!job) {
        report.orphaned.push(sowId);
        log(`sow ${sowId}: job ${sow.jobId} not found, leaving alone`);
        continue;
      }

      const client = normalizeClientEmail(job.clientEmail as string | undefined);
      if (!client) {
        // Nobody submitted this on someone else's behalf, so job.email really is
        // the client's address and the SOW is already right.
        report.skipped += 1;
        continue;
      }

      const current = normalizeClientEmail(sow.clientEmail as string | undefined);
      if (current === client) {
        report.skipped += 1;
        continue;
      }

      const submitter = normalizeClientEmail(job.email as string | undefined);
      if (current !== submitter) {
        // Neither the bug's signature nor already correct: someone changed it.
        report.skipped += 1;
        log(`sow ${sowId}: clientEmail "${sow.clientEmail}" is neither the submitter's nor the client's, leaving alone`);
        continue;
      }

      const issued = (await versions.find({ sowId }).toArray()).filter((version) => version.visibleToCustomer === true).map((version) => Number(version.versionNumber));

      if (opts.dryRun) {
        log(`[dry] sow ${sowId}: ${sow.clientEmail} → ${job.clientEmail}`);
      } else {
        await sows.updateOne({ _id: sow._id }, { $set: { clientEmail: job.clientEmail } });
        log(`sow ${sowId}: ${sow.clientEmail} → ${job.clientEmail}`);
      }
      report.corrected += 1;
      if (issued.length > 0) {
        report.needsReissue.push({ sowId, issuedVersions: issued.sort((a, b) => a - b) });
      }
    } catch (error) {
      report.failed.push({ id: sowId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return report;
}

/** SOW.jobId is a string; jobs are keyed by ObjectId in Mongo but by string in tests. */
function toJobId(jobId: unknown): any {
  const raw = String(jobId);
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : raw;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry') || process.argv.includes('--dry-run');
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Run with: node --env-file=.env dist/src/sow/backfill-sow-client-email.js');
    process.exit(1);
  }

  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database handle after connect');

    console.log(dryRun ? 'Dry run — no writes will be made.' : 'Correcting SOW client emails...');
    const report = await backfillSowClientEmail(db, { dryRun });

    console.log('\n--- SOW clientEmail backfill ---');
    console.log(`scanned  : ${report.scanned}`);
    console.log(`corrected: ${report.corrected}${dryRun ? ' (would be)' : ''}`);
    console.log(`skipped  : ${report.skipped} (already correct, or not staff-submitted)`);
    console.log(`orphaned : ${report.orphaned.length} (job missing)`);
    console.log(`failed   : ${report.failed.length}`);
    for (const f of report.failed) console.error(`  ${f.id}: ${f.error}`);

    if (report.needsReissue.length > 0) {
      console.log(`\n${report.needsReissue.length} corrected SOW(s) were already issued to a customer.`);
      console.log('Their stored version text still shows the old address; reissue if that matters:');
      for (const item of report.needsReissue) console.log(`  sow ${item.sowId} — issued version(s) ${item.issuedVersions.join(', ')}`);
    }

    if (report.failed.length > 0) process.exitCode = 1;
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
