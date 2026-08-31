import { ACTORS, gql, gqlError, resetDb, seedService, startTestApp, stopTestApp, TestApp, workflowInput } from './harness';
import * as F from './sow-flow';
import mongoose from 'mongoose';
import { backfillSowClientEmail } from '../../src/sow/backfill-sow-client-email';

/**
 * A job staff submit *on behalf of* a client must reach that client.
 *
 * The job's `sub` and `email` are the staff member's — that is unavoidable, they
 * are read from the submitter's token — so the client's only link to it is the
 * `clientEmail` typed on the staff submission form. Every read path a client has
 * must honour that link, and the list is the one that matters most: it is the
 * only route to the job detail page, and from there to the SOW. A client who
 * cannot see the row cannot reach anything behind it, however correct the
 * per-document checks are.
 *
 * These run against a real Mongo because the list is an aggregation pipeline;
 * asserting on a constructed filter object would pass whether or not the server
 * accepts the query.
 */

jest.setTimeout(60000);

describe('jobs staff submitted for a client', () => {
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

  /** What StaffJobSubmit sends: staff's token, the client's email in the body. */
  async function staffSubmitsFor(clientEmail: string | undefined, name = 'Job for a client'): Promise<string> {
    const data = await gql(ctx, 'staff', `mutation ($input: CreateJobInput!) { createJob(createJobInput: $input) { id } }`, {
      input: {
        name,
        institute: 'Boston University',
        notes: 'Submitted by staff on behalf of a client',
        clientDisplayName: 'Cara Client',
        ...(clientEmail === undefined ? {} : { clientEmail }),
        workflows: [workflowInput(serviceId)]
      }
    });
    return data.createJob.id;
  }

  async function jobIdsVisibleTo(actor: 'customer' | 'otherCustomer'): Promise<string[]> {
    const data = await gql(ctx, actor, `query ($input: JobsForViewerInput) { jobsForViewer(input: $input) { items { id } totalCount } }`, { input: { scope: 'ALL' } });
    return data.jobsForViewer.items.map((item: { id: string }) => item.id);
  }

  it('shows the job to the client named on it', async () => {
    const jobId = await staffSubmitsFor(ACTORS.customer.email);

    expect(await jobIdsVisibleTo('customer')).toContain(jobId);
  });

  it('does not show it to a different client', async () => {
    const jobId = await staffSubmitsFor(ACTORS.customer.email);

    expect(await jobIdsVisibleTo('otherCustomer')).not.toContain(jobId);
  });

  it('matches the email regardless of how staff capitalised it', async () => {
    // Staff type this address by hand, and Keycloak's copy is lower case.
    const jobId = await staffSubmitsFor('Client@BU.Test');

    expect(await jobIdsVisibleTo('customer')).toContain(jobId);
  });

  it('leaves a job with no client email visible only to its submitter', async () => {
    // The empty-email trap: a clause built from a missing address must not
    // degenerate into "every job whose clientEmail is unset".
    const jobId = await staffSubmitsFor(undefined);

    expect(await jobIdsVisibleTo('customer')).not.toContain(jobId);
    expect(await jobIdsVisibleTo('otherCustomer')).not.toContain(jobId);
  });

  it('lets the client read and sign the SOW behind that job', async () => {
    // The end of the chain, and the point of the whole feature: list -> job ->
    // SOW -> signature. Every step reads ownership off the same `clientEmail`,
    // and the signature is the one action staff cannot take on the client's
    // behalf, so a mismatch here strands the document with no way forward.
    const jobId = await staffSubmitsFor('Client@BU.Test');
    await F.reviewJob(ctx, 'staff', jobId, 'ACCEPT', `op-accept-${jobId}`);
    const sow = await F.createSowForJob(ctx, 'staff', jobId);
    const draft = await F.readSow(ctx, 'staff', sow.id);
    await F.saveSowVersion(ctx, 'staff', sow.id, draft.currentVersion, { note: 'Filled in' });
    await F.sendSowToCustomer(ctx, 'staff', sow.id);

    const customerView = await F.readSow(ctx, 'customer', sow.id);
    expect(customerView.actionGate).toMatchObject({ canSign: true, signBlockers: [] });

    const signed = await F.signSow(ctx, 'customer', sow.id, F.signatureFor(customerView.activeVersion, 'Cara Client'));
    expect(signed.status).toBe('SIGNED');
  });

  it('still keeps that SOW away from a client not named on the job', async () => {
    const jobId = await staffSubmitsFor('Client@BU.Test');
    await F.reviewJob(ctx, 'staff', jobId, 'ACCEPT', `op-accept-${jobId}`);
    const sow = await F.createSowForJob(ctx, 'staff', jobId);

    const error = await gqlError(ctx, 'otherCustomer', `query ($id: ID!) { sowById(id: $id) { id } }`, { id: sow.id });
    expect(error).toMatch(/permission/i);
  });

  /**
   * Finding the job from the staff side.
   *
   * The client's name and email live in `clientDisplayName`/`clientEmail` on a
   * staff-submitted job; `username` and `email` are the technician's. So a search
   * that covers only the latter pair finds these jobs by everything except the
   * one thing staff would actually type.
   */
  /**
   * The staff-side client filter.
   *
   * Keyed on the client's *effective email* — the clientEmail staff recorded, or
   * the submitter's own address when nobody submitted on their behalf. Keying on
   * `sub` cannot work: a staff-submitted job carries the technician's sub and the
   * client's sub appears nowhere on it. Email is the one identifier present on
   * every job, and it merges a client's own submissions with the ones made for
   * them instead of splitting them across two filter entries.
   */
  describe('the jobs page client filter', () => {
    async function clients(): Promise<Array<{ clientKey: string; displayName: string }>> {
      const data = await gql(ctx, 'staff', `query { jobClients { clientKey displayName } }`);
      return data.jobClients;
    }

    async function idsFilteredToClient(clientKey: string): Promise<string[]> {
      const data = await gql(ctx, 'staff', `query ($input: JobsForViewerInput) { jobsForViewer(input: $input) { items { id } } }`, { input: { scope: 'ALL', createdByClient: clientKey } });
      return data.jobsForViewer.items.map((item: { id: string }) => item.id);
    }

    it('files a staff-submitted job under its client, not its submitter', async () => {
      await staffSubmitsFor('client@bu.test');

      expect(await clients()).toEqual([{ clientKey: 'client@bu.test', displayName: 'Cara Client' }]);
    });

    it('lists a client once when they have both their own job and one submitted for them', async () => {
      await staffSubmitsFor('client@bu.test');
      await F.createJob(ctx, 'customer', [workflowInput(serviceId)], 'Self-submitted');

      const keys = (await clients()).map((client) => client.clientKey);
      expect(keys).toEqual(['client@bu.test']);
    });

    it("filters to both of that client's jobs at once", async () => {
      const staffJobId = await staffSubmitsFor('client@bu.test');
      const ownJob = await F.createJob(ctx, 'customer', [workflowInput(serviceId)], 'Self-submitted');
      const strangerJob = await F.createJob(ctx, 'otherCustomer', [workflowInput(serviceId)], 'Someone else');

      const filtered = await idsFilteredToClient('client@bu.test');
      // Length as well as membership: arrayContaining alone would pass a filter
      // that had quietly stopped narrowing at all.
      expect(filtered).toHaveLength(2);
      expect(filtered).toEqual(expect.arrayContaining([staffJobId, ownJob.id]));
      expect(filtered).not.toContain(strangerJob.id);
    });

    it('still honours the deprecated createdBySub filter', async () => {
      const ownJob = await F.createJob(ctx, 'customer', [workflowInput(serviceId)], 'Self-submitted');
      await F.createJob(ctx, 'otherCustomer', [workflowInput(serviceId)], 'Someone else');

      const data = await gql(ctx, 'staff', `query ($input: JobsForViewerInput) { jobsForViewer(input: $input) { items { id } } }`, { input: { scope: 'ALL', createdBySub: ACTORS.customer.sub } });
      expect(data.jobsForViewer.items.map((item: { id: string }) => item.id)).toEqual([ownJob.id]);
    });

    it('ignores a client filter from a caller who may not see every job', async () => {
      const staffJobId = await staffSubmitsFor('client@bu.test');
      await F.createJob(ctx, 'otherCustomer', [workflowInput(serviceId)], 'Someone else');

      // A client naming another client must still get only their own jobs.
      const data = await gql(ctx, 'customer', `query ($input: JobsForViewerInput) { jobsForViewer(input: $input) { items { id } } }`, { input: { scope: 'ALL', createdByClient: 'stranger@bu.test' } });
      expect(data.jobsForViewer.items.map((item: { id: string }) => item.id)).toEqual([staffJobId]);
    });
  });

  /**
   * The correction script, against a real collection.
   *
   * The colocated unit spec drives it through an in-memory stand-in keyed by
   * string, which cannot exercise the one piece of real-database behaviour the
   * script depends on: SOW.jobId is a string, and jobs are keyed by ObjectId.
   */
  describe('backfilling SOWs written before the fix', () => {
    it('repoints a SOW at the client and leaves an ordinary one alone', async () => {
      const staffJobId = await staffSubmitsFor('client@bu.test');
      await F.reviewJob(ctx, 'staff', staffJobId, 'ACCEPT', `op-accept-${staffJobId}`);
      const staffSow = await F.createSowForJob(ctx, 'staff', staffJobId);

      const ownJob = await F.createJob(ctx, 'customer', [workflowInput(serviceId)], 'Self-submitted');
      await F.reviewJob(ctx, 'staff', ownJob.id, 'ACCEPT', `op-accept-${ownJob.id}`);
      const ownSow = await F.createSowForJob(ctx, 'staff', ownJob.id);

      // Put the staff SOW back the way createForJob used to leave it.
      const sows = ctx.connection.collection('sows');
      await sows.updateOne({ _id: new mongoose.Types.ObjectId(staffSow.id) }, { $set: { clientEmail: ACTORS.staff.email } });

      const report = await backfillSowClientEmail(ctx.connection.db as any, { log: () => undefined });

      expect(report.corrected).toBe(1);
      expect(report.orphaned).toEqual([]);
      expect((await sows.findOne({ _id: new mongoose.Types.ObjectId(staffSow.id) }))?.clientEmail).toBe('client@bu.test');
      expect((await sows.findOne({ _id: new mongoose.Types.ObjectId(ownSow.id) }))?.clientEmail).toBe(ACTORS.customer.email);
    });
  });

  describe('the staff jobs search', () => {
    async function staffSearchIds(search: string): Promise<string[]> {
      const data = await gql(ctx, 'staff', `query ($input: JobsForViewerInput) { jobsForViewer(input: $input) { items { id } } }`, { input: { scope: 'ALL', search } });
      return data.jobsForViewer.items.map((item: { id: string }) => item.id);
    }

    it('finds a staff-submitted job by the client name on it', async () => {
      const jobId = await staffSubmitsFor('client@bu.test');

      expect(await staffSearchIds('Cara')).toContain(jobId);
    });

    it('finds it by the client email on it', async () => {
      const jobId = await staffSubmitsFor('client@bu.test');

      expect(await staffSearchIds('client@bu.test')).toContain(jobId);
    });

    it('still does not match jobs it should not', async () => {
      const jobId = await staffSubmitsFor('client@bu.test');

      expect(await staffSearchIds('Somebody Else')).not.toContain(jobId);
    });
  });

  /**
   * Rows written before emails were normalised on the way in.
   *
   * Staging already holds jobs whose `clientEmail` is exactly what a staff member
   * typed, capitals and all — normalising on write does nothing for those, and
   * they are the ones the bug report is about. Written straight to the collection
   * because the mutation now cleans the value up, so there is no longer any way to
   * create one through the API.
   */
  describe('jobs stored before the email was normalised on write', () => {
    async function storeRawClientEmail(jobId: string, raw: string): Promise<void> {
      await ctx.connection.collection('jobs').updateOne({ _id: new mongoose.Types.ObjectId(jobId) }, { $set: { clientEmail: raw } });
    }

    it('still lists them for the client', async () => {
      const jobId = await staffSubmitsFor('client@bu.test');
      await storeRawClientEmail(jobId, '  Client@BU.Test ');

      expect(await jobIdsVisibleTo('customer')).toContain(jobId);
    });

    it('still lets the client open them', async () => {
      const jobId = await staffSubmitsFor('client@bu.test');
      await storeRawClientEmail(jobId, 'CLIENT@BU.TEST');

      const data = await gql(ctx, 'customer', `query ($id: ID!) { ownJobById(id: $id) { id } }`, { id: jobId });
      expect(data.ownJobById?.id).toBe(jobId);
    });

    it('still lets the client reach the SOW behind them', async () => {
      const jobId = await staffSubmitsFor('client@bu.test');
      await F.reviewJob(ctx, 'staff', jobId, 'ACCEPT', `op-accept-${jobId}`);
      const sow = await F.createSowForJob(ctx, 'staff', jobId);
      await storeRawClientEmail(jobId, 'CLIENT@BU.TEST');

      const data = await gql(ctx, 'customer', `query ($id: ID!) { sowById(id: $id) { id } }`, { id: sow.id });
      expect(data.sowById?.id).toBe(sow.id);
    });
  });

  it('lets the client open the job it can now see', async () => {
    const jobId = await staffSubmitsFor('Client@BU.Test');

    const data = await gql(ctx, 'customer', `query ($id: ID!) { ownJobById(id: $id) { id } }`, { id: jobId });
    expect(data.ownJobById?.id).toBe(jobId);
  });

  it('serves clientEmail on both job reads, which the job header renders from', async () => {
    // ClientView and TechnicianView decide whether to print "submitted on their
    // behalf" from this field, so it has to be selectable on the customer's read
    // and the staff one alike.
    const jobId = await staffSubmitsFor('Client@BU.Test');

    const asClient = await gql(ctx, 'customer', `query ($id: ID!) { ownJobById(id: $id) { clientEmail clientDisplayName username email institute } }`, { id: jobId });
    const asStaff = await gql(ctx, 'staff', `query ($id: ID!) { jobById(id: $id) { clientEmail clientDisplayName username email institute } }`, { id: jobId });

    expect(asClient.ownJobById.clientEmail).toBe('client@bu.test');
    expect(asStaff.jobById.clientEmail).toBe('client@bu.test');
    // The header names the client from these two and credits the submitter from
    // the other two, so all four have to survive the round trip.
    expect(asStaff.jobById.clientDisplayName).toBe('Cara Client');
    expect(asStaff.jobById.username).toBe(ACTORS.staff.preferred_username);
    expect(asStaff.jobById.email).toBe(ACTORS.staff.email);
  });
});
