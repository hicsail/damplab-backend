import { gql, gqlError, resetDb, seedService, startTestApp, stopTestApp, TestApp, workflowInput } from './harness';
import { migrateSows } from '../../src/sow/migrate-sows';
import mongoose from 'mongoose';
import * as F from './sow-flow';

/**
 * A statement bills a countersigned Statement of Work, or nothing.
 *
 * `createForJob` no longer distinguishes why: sent-but-unsigned, signed-but-
 * uncountersigned, cancelled, withdrawn and never-versioned all refuse in the
 * same words. This still walks the real lifecycle rather than stand-ins,
 * because several of those states — in particular "no version in force"
 * meaning *withdrawn* versus *never issued* — are produced by compare-and-set
 * behaviour that only a real Mongo exhibits: `withdrawSowFromCustomer` zeroes
 * `activeVersionNumber` exactly as never having issued anything leaves it.
 */

jest.setTimeout(60000);

describe('invoicing is gated on a countersigned SOW', () => {
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

  async function draftSow(): Promise<{ jobId: string; sowId: string }> {
    const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
    await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', `op-accept-${job.id}`);
    const sow = await F.createSowForJob(ctx, 'staff', job.id);
    const fresh = await F.readSow(ctx, 'staff', sow.id);
    await F.saveSowVersion(ctx, 'staff', sow.id, fresh.currentVersion, { note: 'Filled in' });
    return { jobId: job.id, sowId: sow.id };
  }

  async function signedSow(): Promise<{ jobId: string; sowId: string }> {
    const { jobId, sowId } = await draftSow();
    await F.sendSowToCustomer(ctx, 'staff', sowId);
    const sent = await F.readSow(ctx, 'staff', sowId);
    await F.signSow(ctx, 'customer', sowId, F.signatureFor(sent.activeVersion, 'Cara Client'));
    return { jobId, sowId };
  }

  const COUNTERSIGNED_MESSAGE = 'Cannot generate an invoice until the Statement of Work is countersigned.';

  async function invoiceError(jobId: string): Promise<string> {
    const { sowByJobId } = await gql(ctx, 'staff', `query ($jobId: ID!) { sowByJobId(jobId: $jobId) { billableServices { serviceId } } }`, { jobId });
    return gqlError(ctx, 'staff', `mutation ($input: CreateInvoiceInput!) { createInvoice(input: $input) { id } }`, {
      input: { jobId, releaseServiceLines: [{ sourceIndex: 0, serviceId: sowByJobId.billableServices[0].serviceId }] }
    });
  }

  async function invoice(jobId: string): Promise<any> {
    const { sowByJobId } = await gql(ctx, 'staff', `query ($jobId: ID!) { sowByJobId(jobId: $jobId) { billableServices { serviceId } } }`, { jobId });
    const data = await gql(ctx, 'staff', `mutation ($input: CreateInvoiceInput!) { createInvoice(input: $input) { id invoiceNumber sowVersionNumber } }`, {
      input: { jobId, releaseServiceLines: [{ sourceIndex: 0, serviceId: sowByJobId.billableServices[0].serviceId }] }
    });
    return data.createInvoice;
  }

  it('refuses a draft that was never sent, which used to invoice off the live figures', async () => {
    const { jobId } = await draftSow();

    expect(await invoiceError(jobId)).toBe(COUNTERSIGNED_MESSAGE);
  });

  it('refuses a SOW sitting with the customer for signature', async () => {
    const { jobId, sowId } = await draftSow();
    await F.sendSowToCustomer(ctx, 'staff', sowId);

    expect(await invoiceError(jobId)).toBe(COUNTERSIGNED_MESSAGE);
  });

  it('refuses a SOW the customer signed but the lab has not countersigned', async () => {
    const { jobId } = await signedSow();

    expect(await invoiceError(jobId)).toBe(COUNTERSIGNED_MESSAGE);
  });

  it('allows it once countersigned, and anchors the invoice to that version', async () => {
    const { jobId, sowId } = await signedSow();
    const final = await F.finalizeSow(ctx, 'staff', sowId, 'Tess Technician');

    const created = await invoice(jobId);

    expect(created.sowVersionNumber).toBe(final.versionNumber);
  });

  /**
   * A countersigned SOW has exactly one exit, and it is not the one the plan for
   * this work assumed.
   *
   * Withdrawing is refused ("only a Statement of Work that is out for signature can
   * be withdrawn") and so is saving an amendment above it ("countersigned and is
   * final. Cancel it and issue a new one"). Cancelling is the only way out, and it
   * makes a CANCELLED row *active* rather than zeroing the pointer.
   *
   * That is why the gate's "countersigned, then withdrawn" message is defensive
   * rather than a live case — see the note on `invoiceBlockedReason`.
   */
  it('cannot be withdrawn or amended once countersigned, so cancelling is the only exit', async () => {
    const { sowId } = await signedSow();
    await F.finalizeSow(ctx, 'staff', sowId, 'Tess Technician');
    const countersigned = await F.readSow(ctx, 'staff', sowId);

    await expect(F.withdrawSowFromCustomer(ctx, 'staff', sowId, 'Wrong scope')).rejects.toThrow(/out for signature can be withdrawn/i);
    await expect(F.saveSowVersion(ctx, 'staff', sowId, countersigned.currentVersion, { note: 'Amend' })).rejects.toThrow(/countersigned and is final/i);
  });

  it('refuses a countersigned SOW that was later cancelled, in the cancellation’s own words', async () => {
    const { jobId, sowId } = await signedSow();
    await F.finalizeSow(ctx, 'staff', sowId, 'Tess Technician');
    await F.cancelSow(ctx, 'staff', sowId, 'Project called off');

    // Countersigning happened and was undone by cancellation, but the gate no
    // longer distinguishes that from any other reason it refuses: the action
    // that clears all of them is the same.
    expect(await invoiceError(jobId)).toBe(COUNTERSIGNED_MESSAGE);
  });

  it('points a pre-versioning SOW at the migration, and lets it through once migrated', async () => {
    const { jobId, sowId } = await draftSow();

    const db = ctx.connection.db;
    if (!db) throw new Error('Mongo connection is not established');
    await db.collection('sow_versions').deleteMany({ sowId: String(sowId) });
    await db.collection('sows').updateOne({ _id: new mongoose.Types.ObjectId(sowId) }, { $set: { currentVersionNumber: 0, activeVersionNumber: 0 } });

    expect(await invoiceError(jobId)).toBe(COUNTERSIGNED_MESSAGE);

    // The remedy is still the SOW migration, even though the message no longer
    // names it directly — see sow-access.spec.ts for `invoiceBlockedReason`
    // itself, which still distinguishes this case for the UI's tooltip.
    await migrateSows(db, { log: () => undefined });
    const migrated = await F.readSow(ctx, 'staff', sowId);
    await F.saveSowVersion(ctx, 'staff', sowId, migrated.currentVersion, { note: 'Filled in' });
    await F.sendSowToCustomer(ctx, 'staff', sowId);
    const sent = await F.readSow(ctx, 'staff', sowId);
    await F.signSow(ctx, 'customer', sowId, F.signatureFor(sent.activeVersion, 'Cara Client'));
    await F.finalizeSow(ctx, 'staff', sowId, 'Tess Technician');

    expect((await invoice(jobId)).invoiceNumber).toBeTruthy();
  });
});
