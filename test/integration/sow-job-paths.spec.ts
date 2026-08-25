import { gqlError, gqlRaw, occupySowNumber, resetDb, seedService, startTestApp, stopTestApp, TestApp, workflowInput } from './harness';
import * as F from './sow-flow';

/**
 * The branches off the happy path.
 *
 * These are the tests that need a database. The colocated unit specs drive the
 * same services against in-memory stand-ins whose query support stops at `$ne`
 * and `$exists`, so a `findOneAndUpdate` there always matches — and every
 * "someone else got here first" branch in the review, version and signature
 * flows is reached precisely when one does not. Anything below that asserts a
 * refusal on a second write is exercising real compare-and-set semantics.
 *
 * Organised by DocumentBlocker where possible, since that enum is the product's
 * own enumeration of what can stand in the way of issuing or signing.
 */

jest.setTimeout(60000);

describe('job -> SOW branch paths', () => {
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

  /** A submitted job, its accepted spec, and a filled-in draft ready to issue. */
  async function readyToSend(): Promise<{ jobId: string; sowId: string }> {
    const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
    await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', `op-accept-${job.id}`);
    const sow = await F.createSowForJob(ctx, 'staff', job.id);
    const fresh = await F.readSow(ctx, 'staff', sow.id);
    await F.saveSowVersion(ctx, 'staff', sow.id, fresh.currentVersion, { note: 'Filled in' });
    return { jobId: job.id, sowId: sow.id };
  }

  async function issued(): Promise<{ jobId: string; sowId: string; activeVersionNumber: number }> {
    const { jobId, sowId } = await readyToSend();
    const sent = await F.sendSowToCustomer(ctx, 'staff', sowId);
    return { jobId, sowId, activeVersionNumber: sent.versionNumber };
  }

  // -------------------------------------------------------------------------
  // Who may do what
  // -------------------------------------------------------------------------

  describe('authorization', () => {
    it('keeps the staff-only half of the flow away from customers', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', 'op-1');

      expect(await gqlError(ctx, 'customer', `mutation ($j: ID!) { createSowForJob(jobId: $j) { id } }`, { j: job.id })).toMatch(/required role/);

      const sow = await F.createSowForJob(ctx, 'staff', job.id);
      expect(await F.sendSowToCustomerError(ctx, 'customer', sow.id)).toMatch(/required role/);
      expect(await F.finalizeSowError(ctx, 'customer', sow.id, 'Cara Client')).toMatch(/required role/);
      expect(await gqlError(ctx, 'customer', `mutation ($i: ReviewJobInput!) { reviewJob(input: $i) { state } }`, { i: { operationId: 'op-2', jobId: job.id, decision: 'ACCEPT' } })).toMatch(
        /required role/
      );
    });

    it("will not let staff sign in the customer's place", async () => {
      const { sowId, activeVersionNumber } = await issued();
      const view = await F.readSow(ctx, 'staff', sowId, activeVersionNumber);

      expect(await F.signSowError(ctx, 'staff', sowId, F.signatureFor(view.activeVersion, 'Tess Technician'))).toMatch(/only the customer who owns this job can sign/i);
    });

    it('hides a SOW from a signed-in user who does not own the job', async () => {
      const { sowId } = await issued();

      const body = await gqlRaw(ctx, 'otherCustomer', `query ($i: ID!) { sowById(id: $i) { id sowNumber } }`, { i: sowId });
      expect(body.data?.sowById).toBeNull();
      expect(body.errors?.[0].message).toMatch(/do not have permission to view this SOW/);
      expect(body.errors?.[0].extensions?.code).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  // What blocks issuing
  // -------------------------------------------------------------------------

  describe('send blockers', () => {
    it('NOT_ACCEPTED: refuses to issue a SOW for a spec the lab has not accepted', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      const sow = await F.createSowForJob(ctx, 'staff', job.id);

      const before = await F.readSow(ctx, 'staff', sow.id);
      expect(before.actionGate.sendBlockers).toEqual(['NOT_ACCEPTED', 'DRAFT_INCOMPLETE']);
      expect(await F.sendSowToCustomerError(ctx, 'staff', sow.id)).toMatch(/accept this job before continuing/i);

      // Accepting clears that blocker and leaves only the unwritten section.
      await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', 'op-1');
      expect((await F.readSow(ctx, 'staff', sow.id)).actionGate.sendBlockers).toEqual(['DRAFT_INCOMPLETE']);
    });

    it('DRAFT_INCOMPLETE: names the unwritten section, and clears once it is written', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', 'op-1');
      const sow = await F.createSowForJob(ctx, 'staff', job.id);

      const fresh = await F.readSow(ctx, 'staff', sow.id);
      expect(fresh.actionGate).toMatchObject({ canSend: false, sendBlockers: ['DRAFT_INCOMPLETE'], missingFields: ['Engagement Resources'] });

      await F.saveSowVersion(ctx, 'staff', sow.id, fresh.currentVersion, { note: 'Filled in' });
      expect((await F.readSow(ctx, 'staff', sow.id)).actionGate).toMatchObject({ canSend: true, sendBlockers: [], missingFields: [] });
    });

    it('NO_DRAFT_TO_SEND: a second issue of the same version is refused', async () => {
      const { sowId } = await issued();

      expect(await F.sendSowToCustomerError(ctx, 'staff', sowId)).toMatch(/Only a draft can be sent; v1000 is SENT/);
      expect((await F.readSow(ctx, 'staff', sowId)).actionGate.sendBlockers).toEqual(['NO_DRAFT_TO_SEND']);
      // The double click must not have issued a second version.
      expect((await F.sowVersions(ctx, 'staff', sowId)).filter((v) => v.status === 'SENT')).toHaveLength(1);
    });

    it('refuses to edit a SOW that is out with the customer', async () => {
      const { sowId } = await issued();
      const current = await F.readSow(ctx, 'staff', sowId);

      await expect(F.saveSowVersion(ctx, 'staff', sowId, current.currentVersion, { note: 'sneaky edit' })).rejects.toThrow(/withdraw it before editing/i);
    });
  });

  // -------------------------------------------------------------------------
  // What blocks signing
  // -------------------------------------------------------------------------

  describe('sign blockers', () => {
    it('STALE_SIGN_VERSION: a customer holding a withdrawn version cannot sign it', async () => {
      const { sowId, activeVersionNumber } = await issued();
      const staleView = await F.readSow(ctx, 'customer', sowId, activeVersionNumber);
      const staleSignature = F.signatureFor(staleView.activeVersion, 'Cara Client');

      // Staff pull it back, revise it and reissue while the customer's page sits open.
      await F.withdrawSowFromCustomer(ctx, 'staff', sowId, 'Corrected the fee schedule');
      const withdrawn = await F.readSow(ctx, 'staff', sowId);
      await F.saveSowVersion(ctx, 'staff', sowId, withdrawn.currentVersion, { note: 'Corrected figures' });
      const reissued = await F.sendSowToCustomer(ctx, 'staff', sowId);
      expect(reissued.versionNumber).toBeGreaterThan(activeVersionNumber);

      // The stale page's signature is refused rather than applied to the new text.
      expect(await F.signSowError(ctx, 'customer', sowId, staleSignature)).toMatch(/no longer the one in force/i);

      // And the gate says so when asked with the version that page is holding.
      expect((await F.readSow(ctx, 'customer', sowId, activeVersionNumber)).actionGate).toMatchObject({ canSign: false, signBlockers: ['STALE_SIGN_VERSION'] });

      // Reloading and signing the version actually in force works.
      const currentView = await F.readSow(ctx, 'customer', sowId, reissued.versionNumber);
      expect((await F.signSow(ctx, 'customer', sowId, F.signatureFor(currentView.activeVersion, 'Cara Client'))).status).toBe('SIGNED');
    });

    it('requires every group of sections to be acknowledged', async () => {
      const { sowId, activeVersionNumber } = await issued();

      const message = await F.signSowError(ctx, 'customer', sowId, { versionNumber: activeVersionNumber, name: 'Cara Client', consentedGroups: [], sectionInitials: [] });
      expect(message).toMatch(/confirm every section/i);
      expect(message).toContain('CALCULATED');
      expect(message).toContain('PROSE');

      // Nothing was recorded by the refused attempt.
      expect((await F.readSow(ctx, 'staff', sowId)).status).toBe('SENT');
    });

    it('AWAITING_CUSTOMER_SIGNATURE: countersigning before the customer signs is refused', async () => {
      const { sowId } = await issued();

      expect((await F.readSow(ctx, 'staff', sowId)).actionGate).toMatchObject({ canCountersign: false, countersignBlockers: ['AWAITING_CUSTOMER_SIGNATURE'] });
      expect(await F.finalizeSowError(ctx, 'staff', sowId, 'Tess Technician')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // Concurrency: the branches that only a real database reaches
  // -------------------------------------------------------------------------

  describe('concurrent writers', () => {
    it('treats a replayed review operationId as the same operation, not a second one', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);

      const first = await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', 'op-retry');
      const replay = await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', 'op-retry');

      expect(first.state).toBe('ACCEPTED');
      expect(replay.state).toBe('ACCEPTED');

      // The retry must not have written a second acceptance into the history.
      const versions = await F.jobVersions(ctx, 'staff', job.id);
      expect(versions.filter((v: any) => v.isEvent && v.note === 'Accepted')).toHaveLength(1);
    });

    it('refuses a save from an editor that loaded an older version', async () => {
      const { sowId } = await readyToSend();
      const current = await F.readSow(ctx, 'staff', sowId);
      expect(current.currentVersion.versionNumber).toBe(2);

      // A colleague's tab still holds v1 and saves over the top.
      await expect(F.saveSowVersion(ctx, 'staff', sowId, current.currentVersion, { baseVersionNumber: 1, note: 'stale tab' })).rejects.toThrow(/you have v1, it is now v2/i);

      // The refused save left no version behind.
      expect((await F.readSow(ctx, 'staff', sowId)).currentVersionNumber).toBe(2);
    });

    /**
     * Regression: this used to surface a raw driver error.
     *
     * SOWService.createForJob checked `findOne({ jobId })` and then created, and
     * resolveSowNumberForNewSow read every SOW to compute max + 1 — both reads
     * followed by a write. Two concurrent clicks each saw no SOW, each picked
     * "SOW 00001", and the loser of the insert race got
     *
     *   E11000 duplicate key error collection: ... index: sowNumber_1
     *
     * The unique indexes always kept the data right; the defect was that the
     * second caller was handed a Mongo error instead of the SOW that by then
     * existed. sow-create-for-job.spec.ts aims at exactly this case ("A second
     * click must not attempt a create that the unique job index rejects") but
     * its fake model returns the existing SOW synchronously, so it can only
     * reach the sequential path below.
     */
    it('returns the existing SOW rather than a duplicate when Generate is clicked twice', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);

      const [first, second] = await Promise.all([F.createSowForJob(ctx, 'staff', job.id), F.createSowForJob(ctx, 'staff', job.id)]);

      expect(second.id).toBe(first.id);
      expect(second.sowNumber).toBe(first.sowNumber);
      expect(await F.sowCount(ctx, job.id)).toBe(1);
    });

    /**
     * The other half of the same defect: two *different* jobs, so the unique
     * index on jobId does not separate them and both legitimately need a SOW.
     * They can only collide on the number each picks.
     *
     * Both preferred numbers are parked first, so each job has to fall through
     * to the shared global sequence — which is the only way two jobs ever reach
     * for the same number, since a job prefers "SOW <its own display id>" and
     * display ids are handed out sequentially. That is why the collision went
     * unnoticed for so long.
     *
     * Note this asserts the outcome, not contention: driving these two calls
     * into a genuine simultaneous insert is not something the front door lets
     * you arrange reliably. The retry that resolves a real collision is covered
     * directly in src/sow/sow-create-race.spec.ts.
     */
    it('gives two jobs falling back to the global sequence one number each', async () => {
      const jobA = await F.createJob(ctx, 'customer', [workflowInput(serviceId)], 'Job A');
      const jobB = await F.createJob(ctx, 'customer', [workflowInput(serviceId)], 'Job B');

      await occupySowNumber(ctx, 'SOW 00001');
      await occupySowNumber(ctx, 'SOW 00002');

      const [sowA, sowB] = await Promise.all([F.createSowForJob(ctx, 'staff', jobA.id), F.createSowForJob(ctx, 'staff', jobB.id)]);

      expect(sowA.id).not.toBe(sowB.id);
      expect([sowA.sowNumber, sowB.sowNumber].sort()).toEqual(['SOW 00003', 'SOW 00004']);
      expect(await F.sowCount(ctx, jobA.id)).toBe(1);
      expect(await F.sowCount(ctx, jobB.id)).toBe(1);
    });

    it('is idempotent when Generate is clicked twice in sequence', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);

      const first = await F.createSowForJob(ctx, 'staff', job.id);
      const second = await F.createSowForJob(ctx, 'staff', job.id);

      expect(second.id).toBe(first.id);
      expect(second.sowNumber).toBe(first.sowNumber);
    });

    it('issues each job its own SOW number', async () => {
      const jobA = await F.createJob(ctx, 'customer', [workflowInput(serviceId)], 'Job A');
      const jobB = await F.createJob(ctx, 'customer', [workflowInput(serviceId)], 'Job B');

      const sowA = await F.createSowForJob(ctx, 'staff', jobA.id);
      const sowB = await F.createSowForJob(ctx, 'staff', jobB.id);

      expect(sowA.sowNumber).toBe('SOW 00001');
      expect(sowB.sowNumber).toBe('SOW 00002');
    });
  });

  // -------------------------------------------------------------------------
  // Re-accepting a spec that moved
  // -------------------------------------------------------------------------

  describe('acceptance is a baseline, not a one-off', () => {
    /**
     * Re-acceptance is deliberate, not a hole in the state machine:
     * ensureReviewJobWritten lists ACCEPTED among the states a review may act
     * on. This is what that is for — the spec moved after it was agreed, the
     * document says so, and accepting again re-baselines it.
     */
    it('refuses to edit the graph of a job whose SOW is priced against the accepted spec', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', 'op-accept-1');

      const message = await F.saveJobWorkflowsError(ctx, 'staff', job.id, [F.editorWorkflow(serviceId, ['node-1', 'node-2'])], 'Added a second PCR run');
      expect(message).toMatch(/withdraw the acceptance before editing/i);
    });

    /**
     * DOCUMENT_STALE, and the repair sequence behind it.
     *
     * The gate is documented as ordered so the UI shows one repair at a time
     * rather than several competing alarms, and this is that in practice: the
     * figures in the document no longer match the job, and that is the thing
     * staff must fix first, so it is the only blocker reported.
     */
    it('DOCUMENT_STALE: repricing a job blocks its SOW until the figures are recalculated', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);
      await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', 'op-accept-1');
      const sow = await F.createSowForJob(ctx, 'staff', job.id);
      const fresh = await F.readSow(ctx, 'staff', sow.id);
      await F.saveSowVersion(ctx, 'staff', sow.id, fresh.currentVersion, { note: 'Filled in' });
      expect((await F.readSow(ctx, 'staff', sow.id)).actionGate.canSend).toBe(true);

      // Moving the job to another price list changes what is billed without
      // touching the graph, so it slips past the edit guard above.
      await F.changeJobCustomerCategory(ctx, 'staff', job.id, 'EXTERNAL_CUSTOMER_MARKET');

      const moved = await F.readSow(ctx, 'staff', sow.id);
      expect(moved.actionGate).toMatchObject({ canSend: false, sendBlockers: ['DOCUMENT_STALE'] });
      expect(await F.sendSowToCustomerError(ctx, 'staff', sow.id)).toBeTruthy();

      // Recalculating the document alone does NOT clear it: the figures are
      // measured against the spec the lab accepted, not against the live job.
      const stale = await F.readSow(ctx, 'staff', sow.id);
      await F.saveSowVersion(ctx, 'staff', sow.id, stale.currentVersion, { note: 'Recalculated for the market price list', refreshFeeSchedule: true });
      expect((await F.readSow(ctx, 'staff', sow.id)).actionGate.sendBlockers).toEqual(['DOCUMENT_STALE']);

      // Re-accepting is what re-baselines it, and the blocker clears.
      await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', 'op-accept-2');
      expect((await F.readSow(ctx, 'staff', sow.id)).actionGate).toMatchObject({ canSend: true, sendBlockers: [] });
    });

    /**
     * The flip side, and the reason the duplicate "Accepted" entries I first
     * took for a bug are not one: each acceptance is its own operation, so a
     * second one with a fresh operationId is recorded as a second acceptance
     * even when nothing changed in between. Only a retry of the *same*
     * operation collapses (see the replay test above).
     *
     * This pins today's behaviour rather than endorsing it: a redundant accept
     * of an unchanged spec still appends history and re-stamps acceptedAt. If
     * that is ever made a no-op, this test should be the one that notices.
     */
    it('records a second acceptance of an unchanged spec as its own event', async () => {
      const job = await F.createJob(ctx, 'customer', [workflowInput(serviceId)]);

      await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', 'op-accept-1');
      await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', 'op-accept-2');

      const accepted = (await F.jobVersions(ctx, 'staff', job.id)).filter((v: any) => v.isEvent && v.note === 'Accepted');
      expect(accepted).toHaveLength(2);
      expect((await F.jobState(ctx, 'staff', job.id)).state).toBe('ACCEPTED');
    });
  });

  // -------------------------------------------------------------------------
  // The rule the whole version scheme exists to protect
  // -------------------------------------------------------------------------

  describe('a recorded signature', () => {
    it('survives staff continuing to edit the document', async () => {
      const { sowId, activeVersionNumber } = await issued();
      const view = await F.readSow(ctx, 'customer', sowId, activeVersionNumber);
      const signed = await F.signSow(ctx, 'customer', sowId, F.signatureFor(view.activeVersion, 'Cara Client'));

      const afterSign = await F.readSow(ctx, 'staff', sowId);
      expect(afterSign.activeVersionNumber).toBe(signed.versionNumber);

      // Staff open the signed document and save an edit on top of it.
      const draft = await F.saveSowVersion(ctx, 'staff', sowId, afterSign.currentVersion, { note: 'Typo in the completion criteria' });
      expect(draft.versionNumber).toBeGreaterThan(signed.versionNumber);

      // The version in force — the one the customer signed — has not moved.
      const afterEdit = await F.readSow(ctx, 'staff', sowId);
      expect(afterEdit.activeVersionNumber).toBe(signed.versionNumber);
      expect(afterEdit.activeVersion.clientSignature.name).toBe('Cara Client');
      expect(afterEdit.currentVersionNumber).toBe(draft.versionNumber);
    });
  });
});
