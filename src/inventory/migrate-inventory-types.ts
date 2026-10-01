/**
 * One-shot migration: map legacy InventoryItemType values to the new enum.
 *
 * Run with:
 *   npm run migrate:inventory-types            # apply
 *   npm run migrate:inventory-types -- --dry   # report only
 *
 * Idempotent: items already using the new enum values are skipped.
 *
 * Maps only the four legacy enum values below. `type` has been a free string
 * since #72, so any other value (a lab's own "Freezer", "Centrifuge", ...) is
 * deliberate data and is left alone — this script must never overwrite it.
 */
import mongoose from 'mongoose';
import { SUGGESTED_INVENTORY_TYPES } from './inventory.model';
import { parseScriptFlags } from '../script-flags';

const TYPE_MAP: Record<string, string> = {
  ROBOT: 'EQUIPMENT',
  MACHINE: 'EQUIPMENT',
  INSTRUMENT: 'EQUIPMENT',
  OTHER: 'EQUIPMENT'
  // CONSUMABLE stays CONSUMABLE — no mapping needed
};

interface MigrationReport {
  scanned: number;
  migrated: number;
  skipped: number;
  /** Free-string types this script does not know; never rewritten. */
  leftAlone: Array<{ id: string; type: string }>;
  failed: Array<{ id: string; error: string }>;
}

export async function migrateInventoryTypes(db: mongoose.mongo.Db, opts: { dryRun?: boolean; log?: (msg: string) => void } = {}): Promise<MigrationReport> {
  const log = opts.log ?? console.log;
  const items = db.collection('inventoryitems');

  const report: MigrationReport = { scanned: 0, migrated: 0, skipped: 0, leftAlone: [], failed: [] };
  const cursor = items.find({});

  for await (const raw of cursor) {
    report.scanned += 1;
    const id = String(raw._id);
    const currentType = raw.type as string | undefined;

    try {
      const mappedType = currentType && Object.prototype.hasOwnProperty.call(TYPE_MAP, currentType) ? TYPE_MAP[currentType] : undefined;
      if (!mappedType) {
        report.skipped += 1;
        if (currentType && !SUGGESTED_INVENTORY_TYPES.includes(currentType)) report.leftAlone.push({ id, type: currentType });
        continue;
      }

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
  const { dryRun } = parseScriptFlags(process.argv.slice(2));
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Run with: node --env-file=.env dist/inventory/migrate-inventory-types.js');
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
    console.log(`skipped : ${report.skipped} (not a legacy value)`);
    console.log(`left alone: ${report.leftAlone.length} (custom types, never rewritten)`);
    for (const item of report.leftAlone) console.log(`  ${item.id}: "${item.type}"`);
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
