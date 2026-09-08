import mongoose from 'mongoose';

/**
 * Read-only audit: which jobs a countersign gate on invoicing would block.
 *
 * Run this BEFORE deploying that gate. `createForJob` is about to refuse any job
 * whose SOW has no `FINAL` (countersigned) version in force. That is the right
 * rule going forward, but it is retroactive: every SOW already sitting in another
 * state stops being invoiceable the moment it ships, and some of them can never
 * reach `FINAL` at all.
 *
 * The three buckets need three different answers, which is why they are counted
 * separately rather than as one number:
 *
 *   - `neverCountersigned` — the SOW is versioned and simply has not been
 *     countersigned yet. Legitimately blocked; staff countersign and proceed. No
 *     action needed before deploying.
 *   - `countersignedThenWithdrawn` — a FINAL version exists in this SOW's history,
 *     but nothing is in force now: `withdrawSowFromCustomer` zeroes
 *     `activeVersionNumber`, and `cancel` makes a CANCELLED row active. Also
 *     legitimately blocked — there is no document to bill against — but staff will
 *     remember countersigning it, so the refusal has to say *withdrawn*, not "not
 *     countersigned".
 *   - `legacyUnversioned` — no `sow_versions` rows at all. These predate SOW
 *     versioning and have no path to FINAL, so the gate closes them permanently.
 *     **This is the bucket that decides whether the gate can ship as written.**
 *
 * Each is cross-cut by whether the job already has a standing invoice, because a
 * job that has been part-invoiced and can no longer be invoiced again is a
 * different (worse) problem from one that was never billed.
 *
 * Writes nothing, ever. There is no --dry because there is no apply.
 */

const FINAL = 'FINAL';

export interface BlockedJob {
  jobId: string;
  sowId: string;
  sowNumber: string | null;
  sowStatus: string | null;
  activeVersionNumber: number;
  activeVersionStatus: string | null;
  /** Standing (non-voided) invoices already generated for this job. */
  invoiceCount: number;
  createdAt: string | null;
}

export interface CountersignGateAuditReport {
  scannedSows: number;
  /** SOWs a FINAL version is in force for — unaffected by the gate. */
  invoiceable: number;
  neverCountersigned: BlockedJob[];
  countersignedThenWithdrawn: BlockedJob[];
  legacyUnversioned: BlockedJob[];
}

/** Every blocked job that has already been part-invoiced, across all three buckets. */
export function alreadyInvoiced(report: CountersignGateAuditReport): BlockedJob[] {
  return [...report.neverCountersigned, ...report.countersignedThenWithdrawn, ...report.legacyUnversioned].filter((job) => job.invoiceCount > 0);
}

export async function auditCountersignGate(db: mongoose.mongo.Db): Promise<CountersignGateAuditReport> {
  const sows = await db.collection('sows').find({}).toArray();

  const report: CountersignGateAuditReport = {
    scannedSows: sows.length,
    invoiceable: 0,
    neverCountersigned: [],
    countersignedThenWithdrawn: [],
    legacyUnversioned: []
  };

  for (const sow of sows) {
    const sowId = String((sow as any)._id);
    const jobId = String((sow as any).jobId ?? '');
    const activeVersionNumber = Number((sow as any).activeVersionNumber ?? 0);

    // Staged rows are writes in flight and discarded rows were abandoned; neither
    // is reachable through the parent pointers, so neither counts as history.
    const versions = await db
      .collection('sow_versions')
      .find({ sowId, isStaged: { $ne: true }, isDiscarded: { $ne: true } })
      .toArray();

    const active = activeVersionNumber > 0 ? versions.find((v) => Number((v as any).versionNumber) === activeVersionNumber) : undefined;
    const activeIsFinal = active?.status === FINAL && (active as any).visibleToCustomer === true;

    if (activeIsFinal) {
      report.invoiceable += 1;
      continue;
    }

    // Counts standing invoices only: a voided invoice releases its lines, so a job
    // whose only invoice was voided has effectively not been billed.
    const invoiceCount = await db.collection('invoices').countDocuments({ jobId, voidedAt: null });

    const row: BlockedJob = {
      jobId,
      sowId,
      sowNumber: (sow as any).sowNumber ? String((sow as any).sowNumber) : null,
      sowStatus: (sow as any).status ? String((sow as any).status) : null,
      activeVersionNumber,
      activeVersionStatus: active?.status ? String(active.status) : null,
      invoiceCount,
      createdAt: (sow as any).createdAt ? new Date((sow as any).createdAt).toISOString() : null
    };

    if (versions.length === 0) {
      report.legacyUnversioned.push(row);
    } else if (versions.some((v) => (v as any).status === FINAL)) {
      report.countersignedThenWithdrawn.push(row);
    } else {
      report.neverCountersigned.push(row);
    }
  }

  return report;
}

function describe(label: string, rows: BlockedJob[]): void {
  if (rows.length === 0) return;
  console.warn(`  ${label}: ${rows.length} (${rows.filter((r) => r.invoiceCount > 0).length} already part-invoiced)`);
  for (const row of rows.slice(0, 20)) {
    const billed = row.invoiceCount > 0 ? ` — ${row.invoiceCount} standing invoice(s)` : '';
    console.warn(`    - job ${row.jobId} / SOW ${row.sowNumber ?? row.sowId} [${row.sowStatus ?? 'no status'}]${billed}`);
  }
  if (rows.length > 20) console.warn(`    … and ${rows.length - 20} more (see the JSON above)`);
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set. Run with: node --env-file=.env dist/invoice/audit-countersign-gate.js');

  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error('No database handle after connect');

    const report = await auditCountersignGate(db);
    console.log('Read-only audit — nothing was written.');
    console.log(JSON.stringify(report, null, 2));

    if (report.legacyUnversioned.length === 0 && report.neverCountersigned.length === 0 && report.countersignedThenWithdrawn.length === 0) {
      console.log('Every SOW has a countersigned version in force. The gate is safe to deploy as-is.');
      return;
    }

    console.warn('Jobs the countersign gate would block:');
    describe('never countersigned (staff can countersign)', report.neverCountersigned);
    describe('countersigned then withdrawn or cancelled (refusal wording matters)', report.countersignedThenWithdrawn);
    describe('LEGACY, no versions — can never reach FINAL', report.legacyUnversioned);

    if (report.legacyUnversioned.length > 0) {
      console.warn('');
      console.warn(
        `${report.legacyUnversioned.length} SOW(s) can never satisfy the gate. Decide before shipping: a creation-date cutoff, a one-off backfill, or accept that those jobs are closed to further invoicing. This is a business call.`
      );
    }
    const stranded = alreadyInvoiced(report);
    if (stranded.length > 0) {
      console.warn(`${stranded.length} blocked job(s) already carry a standing invoice — those cannot be invoiced again once the gate ships.`);
    }
    // Non-zero exit so a CI or SSM caller cannot mistake this for a clean run.
    process.exitCode = 1;
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
