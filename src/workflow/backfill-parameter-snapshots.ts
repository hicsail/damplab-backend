/**
 * One-shot, hand-run: give every workflow node (and every job-version node)
 * that has no `parameterSnapshot` one, built from the *current* catalogue —
 * soft-deleted services included. Best effort: a parameter renamed before this
 * runs is recorded under its current name.
 *
 *   npm run build
 *   npm run backfill:parameter-snapshots -- --dry   # report only
 *   npm run backfill:parameter-snapshots            # apply
 *
 * Idempotent: a node that already has a snapshot (even []) is never touched.
 * Also converts staff-submitted jobs to client ownership (B32, migrateStaffSubmittedJobs).
 * Nothing runs this automatically.
 */
import mongoose from 'mongoose';
import { ConfigService } from '@nestjs/config';
import config from '../config';
import { normalizeClientEmail } from '../job/client-email';
import { KeycloakService } from '../keycloak/keycloak.service';
import { buildParameterSnapshot } from './utils/parameter-snapshot.util';
import { effectiveParameters, ParameterSetLike, setsByIdMap } from '../services/effective-parameters';

export interface ParameterSnapshotBackfillReport {
  nodesScanned: number;
  nodesUpdated: number;
  versionsScanned: number;
  versionNodesUpdated: number;
  /** Node ids whose service record no longer exists at all; left without a snapshot. */
  missingService: string[];
  failed: Array<{ id: string; error: string }>;
}

export async function backfillParameterSnapshots(db: mongoose.mongo.Db, opts: { dryRun?: boolean; log?: (msg: string) => void } = {}): Promise<ParameterSnapshotBackfillReport> {
  const log = opts.log ?? console.log;
  const report: ParameterSnapshotBackfillReport = { nodesScanned: 0, nodesUpdated: 0, versionsScanned: 0, versionNodesUpdated: 0, missingService: [], failed: [] };

  const services = new Map<string, any>();
  // The raw record holds only the operation's own parameters; the snapshot needs
  // the effective list, as the loaders give the live paths, or a parameter taken
  // from a Parameter Set is named by its id.
  const setsById = setsByIdMap((await db.collection('parametersets').find({}).toArray()) as unknown as ParameterSetLike[]);
  const withSets = (service: any): any => ({ ...service, parameters: effectiveParameters(service, setsById) });
  for (const service of await db.collection('damplabservices').find({}).toArray()) services.set(String(service._id), service);

  const nodes = db.collection('workflownodes');
  for (const node of await nodes.find({}).toArray()) {
    report.nodesScanned += 1;
    if (Array.isArray(node.parameterSnapshot)) continue;
    const service = services.get(String(node.service));
    if (!service) {
      report.missingService.push(String(node._id));
      log(`node ${node._id}: service ${node.service} not found, leaving alone`);
      continue;
    }
    try {
      const parameterSnapshot = buildParameterSnapshot(withSets(service), node.formData);
      if (!opts.dryRun) await nodes.updateOne({ _id: node._id }, { $set: { parameterSnapshot } });
      report.nodesUpdated += 1;
    } catch (error) {
      report.failed.push({ id: String(node._id), error: error instanceof Error ? error.message : String(error) });
    }
  }

  const versions = db.collection('job_versions');
  for (const version of await versions.find({}).toArray()) {
    report.versionsScanned += 1;
    let changed = 0;
    const workflows = (version.workflows ?? []).map((workflow: any) => ({
      ...workflow,
      nodes: (workflow.nodes ?? []).map((node: any) => {
        if (Array.isArray(node.parameterSnapshot)) return node;
        const service = services.get(String(node.serviceId));
        if (!service) return node;
        try {
          const parameterSnapshot = buildParameterSnapshot(withSets(service), node.formData);
          changed += 1;
          return { ...node, parameterSnapshot };
        } catch (error) {
          report.failed.push({ id: `version ${version._id} node ${node.id}`, error: error instanceof Error ? error.message : String(error) });
          return node;
        }
      })
    }));
    if (changed === 0) continue;
    try {
      if (!opts.dryRun) await versions.updateOne({ _id: version._id }, { $set: { workflows } });
      report.versionNodesUpdated += changed;
    } catch (error) {
      report.failed.push({ id: `version ${version._id}`, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return report;
}

export interface StaffSubmittedMigrationReport {
  scanned: number;
  converted: number;
  /** Jobs whose document changed between the read and the write; left for a re-run. */
  skipped: number;
  /** CLIENT comments whose author was the staff submitter's email, re-pointed at the client. */
  commentsRepaired: number;
  failed: Array<{ id: string; error: string }>;
}

/**
 * B32: a job staff submitted for a client used to be the staff member's (their
 * sub/email/username). Make it the client's, and keep the staff member only as
 * submittedBy. Selected by: clientEmail set, no submittedBy, email != clientEmail.
 * Idempotent because every converted job gains submittedBy. A failed lookup skips
 * the job (reported) rather than converting it with an unset sub.
 */
export async function migrateStaffSubmittedJobs(
  db: mongoose.mongo.Db,
  lookup: (email: string) => Promise<{ sub?: string; username?: string } | null>,
  opts: { dryRun?: boolean; log?: (msg: string) => void } = {}
): Promise<StaffSubmittedMigrationReport> {
  const log = opts.log ?? console.log;
  const report: StaffSubmittedMigrationReport = { scanned: 0, converted: 0, skipped: 0, commentsRepaired: 0, failed: [] };
  const jobs = db.collection('jobs');
  const comments = db.collection('comments');

  // Comments by job, loaded once. Comment.jobId is an ObjectId in Mongo, a string in tests.
  const lookups = new Map<string, Promise<{ sub?: string; username?: string } | null>>();
  const commentsByJob = new Map<string, any[]>();
  for (const comment of await comments.find({}).toArray()) {
    const key = String(comment.jobId);
    commentsByJob.set(key, [...(commentsByJob.get(key) ?? []), comment]);
  }

  for (const job of await jobs.find({}).toArray()) {
    report.scanned += 1;
    const clientEmail = normalizeClientEmail(job.clientEmail as string | undefined);
    if (!clientEmail) continue;

    let submitter = job.submittedBy as { email?: string } | undefined;
    if (!submitter) {
      if (normalizeClientEmail(job.email as string | undefined) === clientEmail) continue;
      let account: { sub?: string; username?: string } | null;
      try {
        let pending = lookups.get(clientEmail);
        if (!pending) {
          // Cached per client, failures included, so one client is asked about once.
          pending = lookup(clientEmail);
          lookups.set(clientEmail, pending);
        }
        account = await pending;
      } catch (error) {
        report.failed.push({ id: String(job._id), error: error instanceof Error ? error.message : String(error) });
        log(`job ${job._id}: client lookup failed, left unconverted (re-run to retry)`);
        continue;
      }
      const $set: Record<string, unknown> = {
        submittedBy: { sub: job.sub, email: job.email, name: job.username },
        email: clientEmail,
        clientEmail
      };
      const $unset: Record<string, 1> = {};
      if (account?.sub) $set.sub = account.sub;
      else $unset.sub = 1;
      if (account?.username) $set.username = account.username;
      else $unset.username = 1;
      // Conditional on the state that was read: the read is of the whole collection and each
      // conversion waits on Keycloak, so an overlapping run or a sub claimed meanwhile must
      // not be overwritten (a second write would replace submittedBy with the client).
      const unchanged = (field: string, value: unknown): Record<string, unknown> => (value === undefined || value === null ? { [field]: { $exists: false } } : { [field]: value });
      const filter = { _id: job._id, submittedBy: { $exists: false }, ...unchanged('sub', job.sub), ...unchanged('email', job.email), ...unchanged('clientEmail', job.clientEmail) };
      if (!opts.dryRun) {
        const result = await jobs.updateOne(filter, Object.keys($unset).length ? { $set, $unset } : { $set });
        if (result.matchedCount === 0) {
          report.skipped += 1;
          log(`job ${job._id}: changed since it was read, left alone (re-run to retry)`);
          continue;
        }
      }
      report.converted += 1;
      submitter = $set.submittedBy as { email?: string };
    }

    // Past comments (approved at the plan gate): the old client page sent job.email
    // — the technician's — as the author of the client's own comments. On a job
    // with a submitter, a CLIENT comment "by" the submitter's email is the client's.
    // Runs for already-converted jobs too, so a re-run still repairs; a repaired
    // comment no longer matches, which is what makes this idempotent.
    const staffEmail = normalizeClientEmail(submitter?.email);
    if (!staffEmail || staffEmail === clientEmail) continue;
    for (const comment of commentsByJob.get(String(job._id)) ?? []) {
      if (comment.authorType !== 'CLIENT' || normalizeClientEmail(comment.author) !== staffEmail) continue;
      if (!opts.dryRun) await comments.updateOne({ _id: comment._id }, { $set: { author: clientEmail } });
      report.commentsRepaired += 1;
    }
  }
  return report;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry') || process.argv.includes('--dry-run');
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Run with: npm run backfill:parameter-snapshots');
    process.exit(1);
  }
  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database handle after connect');
    console.log(dryRun ? 'Dry run — no writes will be made.' : 'Backfilling parameter snapshots...');
    const report = await backfillParameterSnapshots(db, { dryRun });

    // B32. Needs the Keycloak Admin API: without it every converted job would lose its sub.
    const keycloak = new KeycloakService(new ConfigService(config()));
    if (keycloak.isConfigured()) {
      const migration = await migrateStaffSubmittedJobs(
        db,
        async (email) => {
          const user = await keycloak.findUserByExactEmail(email);
          return user ? { sub: user.id, username: user.username } : null;
        },
        { dryRun }
      );
      console.log('\n--- staff-submitted job ownership ---');
      console.log(`jobs scanned  : ${migration.scanned}`);
      console.log(`jobs converted: ${migration.converted}${dryRun ? ' (would be)' : ''}`);
      console.log(`comments repaired: ${migration.commentsRepaired}${dryRun ? ' (would be)' : ''}`);
      console.log(`failed        : ${migration.failed.length} (re-run to retry)`);
      for (const f of migration.failed) console.error(`  ${f.id}: ${f.error}`);
      if (migration.failed.length > 0) process.exitCode = 1;
    } else {
      console.warn('\nKeycloak Admin API is not configured (KEYCLOAK_SERVER_URL / CLIENT_ID / CLIENT_SECRET); skipping the staff-submitted job conversion.');
    }
    console.log('\n--- parameterSnapshot backfill ---');
    console.log(`nodes scanned        : ${report.nodesScanned}`);
    console.log(`nodes updated        : ${report.nodesUpdated}${dryRun ? ' (would be)' : ''}`);
    console.log(`versions scanned     : ${report.versionsScanned}`);
    console.log(`version nodes updated: ${report.versionNodesUpdated}${dryRun ? ' (would be)' : ''}`);
    console.log(`missing service      : ${report.missingService.length}`);
    console.log(`failed               : ${report.failed.length}`);
    for (const f of report.failed) console.error(`  ${f.id}: ${f.error}`);
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
