/**
 * One-shot migration: give every pre-versioning SOW a version 1.
 *
 * Run with:
 *   npm run migrate:sows            # apply
 *   npm run migrate:sows -- --dry   # report only
 *
 * Lives in the backend package rather than scripts/ on purpose. It imports the
 * same buildCalculatedFields and deriveInputs the server uses, so a migrated
 * document is byte-identical to one the running app would produce. The scripts/
 * CLI is a separate package on the raw mongo driver, which would have meant a
 * second copy of the calculator — the exact duplication this feature exists to
 * remove.
 *
 * Idempotent: a SOW that already has any version is skipped, so it is safe to
 * re-run after a partial failure.
 */
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { SOW, SOWStatus, SOWAdjustmentType } from './sow.model';
import { SowField, SowFieldKind, SowConsent } from './sow-version.model';
import { SowVersionService } from './sow-version.service';
import { buildCalculatedFields } from './sow-field-calculator';
import { CUSTOM_FIELD_ORDER_BASE, SOW_PROSE_DEFAULTS } from './sow-field-defaults';

interface MigrationReport {
  scanned: number;
  migrated: number;
  skipped: number;
  failed: Array<{ sowId: string; error: string }>;
}

/** Statuses that mean the customer has already been shown this document. */
const ISSUED_STATUSES = new Set<SOWStatus>([SOWStatus.SENT, SOWStatus.SIGNED, SOWStatus.FINAL, SOWStatus.CANCELLED]);

/**
 * Builds version 1's fields from a legacy SOW.
 *
 * Most sections regenerate exactly, because the inputs are derived from the same
 * SOW. Two need carrying by hand:
 *   - additionalInformation, free text that has no generated equivalent
 *   - SPECIAL_TERM adjustments, which are being removed as an adjustment type;
 *     their wording survives as custom sections so nothing staff wrote is lost
 */
export function buildLegacyFields(sow: SOW, job: { customerCategory?: string; jobId?: string; name?: string } | null): SowField[] {
  const inputs = SowVersionService.deriveInputs(sow, job);
  const ctx = SowVersionService.buildContext(sow, job);
  const fields = buildCalculatedFields(inputs, ctx);

  const additional = (sow.additionalInformation ?? '').trim();
  if (additional) {
    const target = fields.find((f) => f.key === 'additionalInformation');
    if (target) {
      target.value = additional;
      target.isOverridden = additional !== (SOW_PROSE_DEFAULTS.additionalInformation ?? '');
      target.isEnabled = true;
    }
  }

  const specialTerms = (sow.pricing?.adjustments ?? []).filter((a) => a.type === SOWAdjustmentType.SPECIAL_TERM);
  specialTerms.forEach((term, i) => {
    const desc = (term.description ?? '').trim();
    const reason = (term.reason ?? '').trim();
    const body = [desc, reason].filter(Boolean).join(' — ');
    if (!body) return;
    fields.push({
      key: `custom-${randomUUID()}`,
      label: 'Special Term',
      kind: SowFieldKind.CUSTOM,
      order: CUSTOM_FIELD_ORDER_BASE + i,
      value: body,
      calculatedValue: undefined,
      isOverridden: false,
      isEnabled: true,
      allowsTextOverride: true,
      allowsEmpty: true,
      requiresInitials: false
    });
  });

  return fields.sort((a, b) => a.order - b.order);
}

/**
 * Carries a legacy signature onto the version, including the drawn image.
 * Without the image, re-exporting a migrated SOW would produce a PDF missing the
 * signature the customer actually drew — a regression on a signed document.
 */
export function toConsent(signature: { name?: string; signedAt?: string; signatureDataUrl?: string } | undefined | null): SowConsent | undefined {
  if (!signature?.name?.trim()) return undefined;
  const parsed = signature.signedAt ? new Date(signature.signedAt) : new Date();
  return {
    name: signature.name.trim(),
    signedAt: Number.isNaN(parsed.getTime()) ? new Date() : parsed,
    // Legacy signatures predate per-group consent; the signer assented to the
    // whole document, so record that rather than inventing a narrower claim.
    consentedGroups: [SowFieldKind.CALCULATED, SowFieldKind.PROSE, SowFieldKind.CUSTOM],
    sectionInitials: [],
    legacySignatureDataUrl: signature.signatureDataUrl
  };
}

export async function migrateSows(db: mongoose.mongo.Db, opts: { dryRun?: boolean; log?: (msg: string) => void } = {}): Promise<MigrationReport> {
  const log = opts.log ?? console.log;
  const sows = db.collection('sows');
  const versions = db.collection('sow_versions');
  const jobs = db.collection('jobs');

  const report: MigrationReport = { scanned: 0, migrated: 0, skipped: 0, failed: [] };
  const cursor = sows.find({});

  for await (const raw of cursor) {
    report.scanned += 1;
    const sowId = String(raw._id);

    try {
      const already = await versions.findOne({ sowId });
      if (already) {
        report.skipped += 1;
        continue;
      }

      const job = raw.jobId ? await jobs.findOne({ _id: new mongoose.Types.ObjectId(String(raw.jobId)) }).catch(() => null) : null;
      const sow = raw as unknown as SOW;

      const fields = buildLegacyFields(sow, job as any);
      const inputs = SowVersionService.deriveInputs(sow, job as any);
      const status: SOWStatus = (raw.status as SOWStatus) ?? SOWStatus.DRAFT;
      const visibleToCustomer = ISSUED_STATUSES.has(status);

      const clientSignature = toConsent(raw.clientSignature);
      const staffSignature = toConsent(raw.technicianSignature);
      // A migrated SOW already issued under the old flow counts as its own
      // send, same rule createInitialVersion applies going forward.
      const versionNumber = SowVersionService.encodeVersionNumber(visibleToCustomer ? 1 : 0, visibleToCustomer ? 0 : 1);

      if (opts.dryRun) {
        log(
          `[dry] ${raw.sowNumber ?? sowId}: status=${status} visible=${visibleToCustomer} fields=${fields.length} customFromSpecialTerms=${fields.filter((f) => f.kind === SowFieldKind.CUSTOM).length}`
        );
        report.migrated += 1;
        continue;
      }

      await versions.insertOne({
        sow: new mongoose.Types.ObjectId(sowId),
        sowId,
        versionNumber,
        fields,
        inputs,
        status,
        visibleToCustomer,
        sentToCustomerAt: visibleToCustomer ? raw.updatedAt ?? raw.createdAt ?? new Date() : undefined,
        clientSignature,
        staffSignature,
        note: 'Migrated from the pre-versioning SOW flow',
        isDiscarded: false,
        createdBy: raw.createdBy ?? 'migration',
        createdByName: raw.createdBy ?? 'migration',
        createdAt: raw.createdAt ?? new Date()
      });

      await sows.updateOne(
        { _id: raw._id },
        {
          $set: {
            currentVersionNumber: versionNumber,
            activeVersionNumber: visibleToCustomer ? versionNumber : 0,
            documentStale: false
          }
        }
      );

      report.migrated += 1;
      log(`migrated ${raw.sowNumber ?? sowId} (${status})`);
    } catch (error) {
      report.failed.push({ sowId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return report;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry') || process.argv.includes('--dry-run');
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Run with: node --env-file=.env dist/src/sow/migrate-sows.js');
    process.exit(1);
  }

  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database handle after connect');

    console.log(dryRun ? 'Dry run — no writes will be made.' : 'Migrating SOWs...');
    const report = await migrateSows(db, { dryRun });

    console.log('\n--- SOW migration ---');
    console.log(`scanned : ${report.scanned}`);
    console.log(`migrated: ${report.migrated}${dryRun ? ' (would be)' : ''}`);
    console.log(`skipped : ${report.skipped} (already versioned)`);
    console.log(`failed  : ${report.failed.length}`);
    for (const f of report.failed) console.error(`  ${f.sowId}: ${f.error}`);

    if (report.failed.length > 0) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

// Only run when executed directly, so the functions above stay unit-testable.
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
