import { resetDb, seedService, startTestApp, stopTestApp, TestApp, workflowInput } from './harness';
import { createJob, createSowForJob, finalizeSow, readSow, reviewJob, saveSowVersion, sendSowToCustomer, signSow, signatureFor, sowVersions } from './sow-flow';

/**
 * The contract flow end to end, through the real GraphQL API against a real
 * Mongo: customer submits, staff accept, staff draft and issue the Statement of
 * Work, the customer signs, staff countersign.
 *
 * The version numbers asserted here are the flow's own vocabulary. Drafts count
 * up from 1; issuing one promotes it into the 1000 band, and every subsequent
 * lifecycle event takes the next number in that band. Pinning them makes an
 * accidental renumbering visible, because half the gate logic keys off which
 * band a version is in.
 */

jest.setTimeout(60000);

describe('job -> SOW happy path', () => {
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

  it('carries a job from submission to a countersigned SOW', async () => {
    // The customer submits a one-service job.
    const job = await createJob(ctx, 'customer', [workflowInput(serviceId)]);
    expect(job.state).toBe('SUBMITTED');
    expect(job.jobId).toMatch(/^\d{5}$/);

    // Staff accept the spec as submitted.
    expect((await reviewJob(ctx, 'staff', job.id, 'ACCEPT', 'op-accept-1')).state).toBe('ACCEPTED');

    // Generating the SOW gives a numbered DRAFT at v1, incomplete until staff
    // supply the sections the generator cannot compute.
    const sow = await createSowForJob(ctx, 'staff', job.id);
    expect(sow).toMatchObject({ status: 'DRAFT', sowNumber: 'SOW 00001' });

    const fresh = await readSow(ctx, 'staff', sow.id);
    expect(fresh.currentVersion.versionNumber).toBe(1);
    expect(fresh.actionGate).toMatchObject({ canSend: false, sendBlockers: ['DRAFT_INCOMPLETE'], missingFields: ['Engagement Resources'] });

    // Filling it in opens a second draft; the customer is shown neither.
    const draft = await saveSowVersion(ctx, 'staff', sow.id, fresh.currentVersion, { note: 'Filled in engagement resources' });
    expect(draft).toMatchObject({ versionNumber: 2, status: 'DRAFT', visibleToCustomer: false });

    const ready = await readSow(ctx, 'staff', sow.id);
    expect(ready.actionGate).toMatchObject({ canSend: true, sendBlockers: [], canSign: false, signBlockers: ['AWAITING_SENT_VERSION'] });
    expect(ready.activeVersionNumber).toBe(0);

    // Issuing promotes the draft into the issued band and puts it in force.
    const sent = await sendSowToCustomer(ctx, 'staff', sow.id);
    expect(sent).toMatchObject({ versionNumber: 1000, status: 'SENT', visibleToCustomer: true });

    const issued = await readSow(ctx, 'staff', sow.id);
    expect(issued).toMatchObject({ status: 'SENT', currentVersionNumber: 1000, activeVersionNumber: 1000 });
    expect(issued.actionGate).toMatchObject({ canSend: false, sendBlockers: ['NO_DRAFT_TO_SEND'], canSign: true, signBlockers: [] });

    // The customer sees the issued version and nothing else, and may sign it.
    const customerView = await readSow(ctx, 'customer', sow.id, issued.activeVersionNumber);
    expect(customerView.currentVersion.versionNumber).toBe(1000);
    expect(customerView.actionGate).toMatchObject({ canSign: true, signBlockers: [], canSend: false, sendBlockers: [] });

    const signed = await signSow(ctx, 'customer', sow.id, signatureFor(customerView.activeVersion, 'Cara Client'));
    expect(signed).toMatchObject({ versionNumber: 1001, status: 'SIGNED' });
    expect(signed.clientSignature.name).toBe('Cara Client');

    const awaitingCountersign = await readSow(ctx, 'staff', sow.id);
    expect(awaitingCountersign.actionGate).toMatchObject({ canCountersign: true, countersignBlockers: [] });

    // Staff countersign, which locks the document.
    const finalized = await finalizeSow(ctx, 'staff', sow.id, 'Tess Technician');
    expect(finalized).toMatchObject({ versionNumber: 1002, status: 'FINAL' });
    expect(finalized.staffSignature.name).toBe('Tess Technician');
    expect(finalized.clientSignature.name).toBe('Cara Client');

    expect((await readSow(ctx, 'staff', sow.id)).status).toBe('FINAL');

    // The history reads as the audit trail, newest first, with the two working
    // drafts kept internal and every issued version visible to the customer.
    expect(await sowVersions(ctx, 'staff', sow.id)).toEqual([
      expect.objectContaining({ versionNumber: 1002, status: 'FINAL', visibleToCustomer: true }),
      expect.objectContaining({ versionNumber: 1001, status: 'SIGNED', visibleToCustomer: true }),
      expect.objectContaining({ versionNumber: 1000, status: 'SENT', visibleToCustomer: true }),
      expect.objectContaining({ versionNumber: 2, status: 'DRAFT', visibleToCustomer: false }),
      expect.objectContaining({ versionNumber: 1, status: 'DRAFT', visibleToCustomer: false })
    ]);

    // Customers are shown the issued versions only — the working drafts are staff's.
    expect((await sowVersions(ctx, 'customer', sow.id)).map((v) => v.versionNumber)).toEqual([1002, 1001, 1000]);
  });
});
