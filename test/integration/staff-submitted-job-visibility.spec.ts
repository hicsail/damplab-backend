import { ACTORS, gql, gqlError, resetDb, seedService, startTestApp, stopTestApp, TestApp, workflowInput } from './harness';
import * as F from './sow-flow';
import mongoose from 'mongoose';

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
});
