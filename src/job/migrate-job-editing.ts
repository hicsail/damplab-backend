/**
 * One-shot migration: give every job an explicit customerEditingEnabled.
 *
 * Run with:
 *   npm run migrate:job-editing            # apply
 *   npm run migrate:job-editing -- --dry   # report only
 *
 * customerMayEdit reads a missing flag as false, so without this every job that
 * is *currently* with a customer for changes would lock the moment the new
 * backend ships — mid-negotiation, with no comment explaining why. This restores
 * the old rule once, as data: a job in CHANGES_REQUESTED was editable under the
 * state-derived gate, so it gets `true`; everything else gets `false`.
 *
 * Idempotent: a job that already has a boolean flag is skipped, so it is safe to
 * re-run, and safe to run before the new backend is live.
 */
import mongoose from 'mongoose';

/** JobState.CHANGES_REQUESTED — the enum is numeric and stored as its ordinal. */
const CHANGES_REQUESTED = 2;

export interface JobEditingMigrationReport {
  scanned: number;
  enabled: number;
  disabled: number;
  skipped: number;
}

export async function migrateJobEditing(db: mongoose.mongo.Db, opts: { dryRun?: boolean } = {}): Promise<JobEditingMigrationReport> {
  const jobs = db.collection('jobs');
  const report: JobEditingMigrationReport = { scanned: 0, enabled: 0, disabled: 0, skipped: 0 };

  // Only documents with no boolean flag yet. Re-running touches nothing.
  const pending = { customerEditingEnabled: { $not: { $type: 'bool' } } };

  report.scanned = await jobs.countDocuments({});
  report.skipped = report.scanned - (await jobs.countDocuments(pending));

  const toEnable = { ...pending, state: CHANGES_REQUESTED };
  const toDisable = { ...pending, state: { $ne: CHANGES_REQUESTED } };

  report.enabled = await jobs.countDocuments(toEnable);
  report.disabled = await jobs.countDocuments(toDisable);

  if (!opts.dryRun) {
    await jobs.updateMany(toEnable, { $set: { customerEditingEnabled: true } });
    await jobs.updateMany(toDisable, { $set: { customerEditingEnabled: false } });
  }

  return report;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry') || process.argv.includes('--dry-run');
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Run with: node --env-file=.env dist/src/job/migrate-job-editing.js');
    process.exit(1);
  }

  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database handle after connect');

    console.log(dryRun ? 'Dry run — no writes will be made.' : 'Migrating job editing flags...');
    const report = await migrateJobEditing(db, { dryRun });

    console.log('\n--- job editing migration ---');
    console.log(`scanned : ${report.scanned}`);
    console.log(`enabled : ${report.enabled}${dryRun ? ' (would be)' : ''} (was with the customer for changes)`);
    console.log(`disabled: ${report.disabled}${dryRun ? ' (would be)' : ''}`);
    console.log(`skipped : ${report.skipped} (already had a flag)`);
  } finally {
    await mongoose.disconnect();
  }
}

// Only run when executed directly, so the function above stays unit-testable.
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
