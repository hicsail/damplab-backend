import mongoose from 'mongoose';
import { resetDb, seedService, startTestApp, stopTestApp, TestApp, workflowInput } from './harness';
import { migrateSows } from '../../src/sow/migrate-sows';
import * as F from './sow-flow';

/**
 * Can a pre-versioning SOW still be countersigned?
 *
 * This decides how bad the countersign gate on invoicing (see
 * `src/invoice/audit-countersign-gate.ts`) actually is. The audit's third bucket
 * is SOWs with no `sow_versions` rows at all, which predate versioning. If those
 * have no route to `FINAL`, a hard gate closes them to invoicing permanently and
 * needs an exemption before it can ship. If they can simply be pushed through the
 * ordinary flow, the gate is a workflow burden and nothing worse.
 *
 * The answer, verified here rather than reasoned about: **recoverable, but not by
 * hand.** `SowEditorModal` returns early when `currentVersion` is null, so it has
 * nothing to submit; the save that produces does recompose the field structure
 * server-side, but not the inputs behind it, and the send gate then refuses the
 * incomplete document.
 *
 * The remedy already exists and is not in the app: `src/sow/migrate-sows.ts` gives
 * every pre-versioning SOW a version 1, built with the same field calculator the
 * server uses. These tests pin that it works, that it is idempotent, and that
 * `--dry` writes nothing — which is what makes the audit's third bucket a
 * "run the migration first" finding rather than a blocker.
 */

jest.setTimeout(60000);

describe('a SOW with no version rows', () => {
  let ctx: TestApp;
  let serviceId: string;

  beforeAll(async () => {
    ctx = await startTestApp();
  });
  afterAll(async () => {
    await stopTestApp(ctx);
  });
  beforeEach(async () => {
    await resetDb(ctx);
    serviceId = await seedService(ctx);
  });

  /**
   * A SOW in the shape versioning left behind: the document exists, its version
   * rows do not, and both pointers read 0.
   *
   * Built by stripping a real SOW rather than hand-inserting one, so it keeps
   * every other field the current code expects — the point is to test the missing
   * versions, not a hand-rolled document that differs in some other way too.
   */
  async function legacySow(): Promise<{ jobId: string; sowId: string }> {
    const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
    await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', `op-accept-${job.id}`);
    const sow = await F.createSowForJob(ctx, 'staff', job.id);

    const db = ctx.connection.db;
    if (!db) throw new Error('Mongo connection is not established');
    await db.collection('sow_versions').deleteMany({ sowId: String(sow.id) });
    await db.collection('sows').updateOne({ _id: new mongoose.Types.ObjectId(sow.id) }, { $set: { currentVersionNumber: 0, activeVersionNumber: 0 } });

    return { jobId: job.id, sowId: sow.id };
  }

  it('is what the audit calls legacy: no versions, both pointers at zero', async () => {
    const { sowId } = await legacySow();
    const fresh = await F.readSow(ctx, 'staff', sowId);

    expect(fresh).toMatchObject({ currentVersionNumber: 0, activeVersionNumber: 0 });
    expect(fresh.activeVersion).toBeNull();
    expect(await F.sowVersions(ctx, 'staff', sowId)).toEqual([]);
  });

  it('refuses to send the recreated document until its fields are filled, like any other', async () => {
    const { sowId } = await legacySow();
    const fresh = await F.readSow(ctx, 'staff', sowId);
    await F.saveSowVersion(ctx, 'staff', sowId, fresh.currentVersion ?? { fields: [], inputs: {} }, { note: 'Recovered', baseVersionNumber: 0 });

    expect(await F.sendSowToCustomerError(ctx, 'staff', sowId)).toMatch(/Complete the following/i);
  });

  it('can still be saved, which creates its first version', async () => {
    const { sowId } = await legacySow();
    const fresh = await F.readSow(ctx, 'staff', sowId);

    // `currentVersion` is null, so the editor has no version to echo back — it
    // sends baseVersionNumber 0, which is what a fresh SOW looks like anyway.
    const saved = await F.saveSowVersion(ctx, 'staff', sowId, fresh.currentVersion ?? { fields: [], inputs: {} }, { note: 'Recovered', baseVersionNumber: 0 });

    expect(saved.versionNumber).toBeGreaterThan(0);
  });

  it('is not put right by a naive save from an editor that has nothing to send', async () => {
    const { sowId } = await legacySow();
    const fresh = await F.readSow(ctx, 'staff', sowId);

    // `SowEditorModal` returns early when `currentVersion` is null, so it holds no
    // fields and no inputs to submit — this save is what that editor would send.
    await F.saveSowVersion(ctx, 'staff', sowId, fresh.currentVersion ?? { fields: [], inputs: {} }, { note: 'Recovered', baseVersionNumber: 0 });

    // The server does recompose the field structure, so this is NOT a hard dead
    // end. What it cannot recover is the inputs behind those fields, so the
    // document comes back incomplete and the send gate refuses it.
    const recreated = await F.readSow(ctx, 'staff', sowId);
    expect(recreated.currentVersion.fields.length).toBeGreaterThan(0);
    expect(await F.sendSowToCustomerError(ctx, 'staff', sowId)).toMatch(/Complete the following/i);
  });

  it('IS rescued by the migration, which is the remedy the audit is pointing at', async () => {
    const { sowId } = await legacySow();

    const db = ctx.connection.db;
    if (!db) throw new Error('Mongo connection is not established');
    const report = await migrateSows(db, { log: () => undefined });
    expect(report.migrated).toBe(1);

    // Fields are composed by the same calculator the server uses, so the document
    // is the one the app would have produced — and the ordinary flow works on it.
    const migrated = await F.readSow(ctx, 'staff', sowId);
    expect(migrated.currentVersion.fields.length).toBeGreaterThan(0);

    await F.saveSowVersion(ctx, 'staff', sowId, migrated.currentVersion, { note: 'Filled in' });
    await F.sendSowToCustomer(ctx, 'staff', sowId);
    const sent = await F.readSow(ctx, 'staff', sowId);
    await F.signSow(ctx, 'customer', sowId, F.signatureFor(sent.activeVersion, 'Cara Client'));
    const final = await F.finalizeSow(ctx, 'staff', sowId, 'Tess Technician');

    expect(final.status).toBe('FINAL');
  });

  it('is idempotent, so the migration is safe to re-run after a partial failure', async () => {
    await legacySow();
    const db = ctx.connection.db;
    if (!db) throw new Error('Mongo connection is not established');

    expect((await migrateSows(db, { log: () => undefined })).migrated).toBe(1);
    const second = await migrateSows(db, { log: () => undefined });
    expect(second).toMatchObject({ migrated: 0, failed: [] });
    expect(second.skipped).toBeGreaterThan(0);
  });

  it('reports without writing on a dry run', async () => {
    const { sowId } = await legacySow();
    const db = ctx.connection.db;
    if (!db) throw new Error('Mongo connection is not established');

    const report = await migrateSows(db, { dryRun: true, log: () => undefined });

    expect(report.migrated).toBe(1);
    expect(await F.sowVersions(ctx, 'staff', sowId)).toEqual([]);
  });
});
