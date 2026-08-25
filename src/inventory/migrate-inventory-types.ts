/**
 * One-shot migration: map legacy InventoryItemType values to the new enum.
 *
 * Run with:
 *   npm run migrate:inventory-types            # apply
 *   npm run migrate:inventory-types -- --dry   # report only
 *
 * Idempotent: items already using the new enum values are skipped.
 */
import mongoose from 'mongoose';

const TYPE_MAP: Record<string, string> = {
  ROBOT: 'EQUIPMENT',
  MACHINE: 'EQUIPMENT',
  INSTRUMENT: 'EQUIPMENT',
  OTHER: 'EQUIPMENT'
  // CONSUMABLE stays CONSUMABLE — no mapping needed
};

const NEW_TYPES = new Set(['EQUIPMENT', 'HOOD', 'STORAGE', 'CONSUMABLE']);

interface MigrationReport {
  scanned: number;
  migrated: number;
  skipped: number;
  failed: Array<{ id: string; error: string }>;
}

export async function migrateInventoryTypes(db: mongoose.mongo.Db, opts: { dryRun?: boolean; log?: (msg: string) => void } = {}): Promise<MigrationReport> {
  const log = opts.log ?? console.log;
  const items = db.collection('inventoryitems');

  const report: MigrationReport = { scanned: 0, migrated: 0, skipped: 0, failed: [] };
  const cursor = items.find({});

  for await (const raw of cursor) {
    report.scanned += 1;
    const id = String(raw._id);
    const currentType = raw.type as string | undefined;

    try {
      if (!currentType || NEW_TYPES.has(currentType)) {
        report.skipped += 1;
        continue;
      }

      const newType = TYPE_MAP[currentType];
      if (!newType) {
        log(`unknown type "${currentType}" on ${raw.name ?? id}, mapping to EQUIPMENT`);
      }

      const mappedType = newType ?? 'EQUIPMENT';

      if (opts.dryRun) {
        log(`[dry] ${raw.name ?? id}: ${currentType} → ${mappedType}`);
        report.migrated += 1;
        continue;
      }

      await items.updateOne({ _id: raw._id }, { $set: { type: mappedType } });
      report.migrated += 1;
      log(`migrated ${raw.name ?? id}: ${currentType} → ${mappedType}`);
    } catch (error) {
      report.failed.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return report;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry') || process.argv.includes('--dry-run');
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Run with: node --env-file=.env dist/src/inventory/migrate-inventory-types.js');
    process.exit(1);
  }

  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database handle after connect');

    console.log(dryRun ? 'Dry run — no writes will be made.' : 'Migrating inventory types...');
    const report = await migrateInventoryTypes(db, { dryRun });

    console.log('\n--- Inventory type migration ---');
    console.log(`scanned : ${report.scanned}`);
    console.log(`migrated: ${report.migrated}${dryRun ? ' (would be)' : ''}`);
    console.log(`skipped : ${report.skipped} (already new type)`);
    console.log(`failed  : ${report.failed.length}`);
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
