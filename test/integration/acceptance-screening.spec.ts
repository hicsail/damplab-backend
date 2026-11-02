import { getModelToken } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { ScreeningRun } from '../../src/job/screening-run.model';
import { gql, gqlRaw, resetDb, seedService, startTestApp, stopTestApp, TestApp, workflowInput } from './harness';
import * as F from './sow-flow';

/**
 * The acceptance gate, end to end, with the real screening check (every other integration spec
 * has it cleared by the harness). Aclid and SecureDNA are unconfigured, so a rerun on the
 * fixtures, which flag nothing, completes with zero sequences and clears the job.
 *
 * Booting the real app is also what proves the Nest wiring: a bad import cycle between
 * JobReviewService and JobScreeningService fails here, not in the unit specs.
 */

jest.setTimeout(60000);

describe('acceptance screening gate', () => {
  let ctx: TestApp;
  let serviceId: string;

  beforeAll(async () => {
    ctx = await startTestApp({ realScreeningGate: true });
  });
  afterAll(async () => {
    await stopTestApp(ctx);
  });
  beforeEach(async () => {
    await resetDb(ctx);
    serviceId = await seedService(ctx);
  });

  const gate = async (actor: 'staff' | 'customer', jobId: string): Promise<{ state: string; message: string | null }> => {
    const data = await gql(ctx, actor, `query ($jobId: ID!) { jobAcceptanceScreening(jobId: $jobId) { state message } }`, { jobId });
    return data.jobAcceptanceScreening;
  };
  const submit = async (): Promise<string> => (await F.createJob(ctx, 'customer', [workflowInput(serviceId)])).id;
  const journalRows = async (): Promise<number> => (await ctx.connection.db!.collection('jobreviewoperations').countDocuments({})) as number;

  it("refuses ACCEPT on a job with no run, with the gate's message", async () => {
    const jobId = await submit();

    const message = await F.reviewJobError(ctx, 'staff', jobId, 'ACCEPT', 'op-no-run');

    expect(message).toContain('Run screening before accepting');
    expect((await F.jobState(ctx, 'staff', jobId)).state).toBe('SUBMITTED');
    expect(await journalRows()).toBe(0);
  });

  it('jobAcceptanceScreening answers NOT_RUN, then CLEAR after a run', async () => {
    const jobId = await submit();
    expect(await gate('staff', jobId)).toMatchObject({ state: 'NOT_RUN' });

    await F.screenJob(ctx, jobId);

    expect(await gate('staff', jobId)).toEqual({ state: 'CLEAR', message: null });
  });

  it('a run with zero sequences and no Aclid key clears', async () => {
    const jobId = await submit();
    await F.screenJob(ctx, jobId);

    const runs = await gql(ctx, 'staff', `query ($jobId: ID!) { jobScreeningRuns(jobId: $jobId) { sequenceCount customer { status } } }`, { jobId });
    expect(runs.jobScreeningRuns[0]).toMatchObject({ sequenceCount: 0, customer: { status: 'NOT_RUN' } });

    expect((await F.reviewJob(ctx, 'staff', jobId, 'ACCEPT', 'op-clear')).state).toBe('ACCEPTED');
  });

  it('customers cannot read jobAcceptanceScreening', async () => {
    const jobId = await submit();
    const body = await gqlRaw(ctx, 'customer', `query ($jobId: ID!) { jobAcceptanceScreening(jobId: $jobId) { state } }`, { jobId });
    expect(body.errors?.[0]?.message).toMatch(/permission|role|forbidden/i);
  });

  it('a job already accepted reads NOT_REQUIRED, and re-accepting needs no new run', async () => {
    const jobId = await submit();
    await F.screenJob(ctx, jobId);
    await F.reviewJob(ctx, 'staff', jobId, 'ACCEPT', 'op-first');
    await ctx.connection.db!.collection('screeningruns').deleteMany({});

    expect(await gate('staff', jobId)).toEqual({ state: 'NOT_REQUIRED', message: null });
    expect((await F.reviewJob(ctx, 'staff', jobId, 'ACCEPT', 'op-again')).state).toBe('ACCEPTED');
  });

  it('withdrawing acceptance gates the next accept against the same rule', async () => {
    const jobId = await submit();
    await F.screenJob(ctx, jobId);
    await F.reviewJob(ctx, 'staff', jobId, 'ACCEPT', 'op-w1');

    await gql(ctx, 'staff', `mutation ($input: WithdrawJobInput!) { withdrawJobAcceptance(input: $input) { id state } }`, { input: { operationId: 'op-wd', jobId, reason: 'Needs another look' } });
    expect((await F.jobState(ctx, 'staff', jobId)).state).toBe('SUBMITTED');
    expect(await gate('staff', jobId)).toEqual({ state: 'CLEAR', message: null });

    const runs = ctx.app.get<mongoose.Model<any>>(getModelToken(ScreeningRun.name));
    await runs.deleteMany({ jobId });
    expect(await gate('staff', jobId)).toMatchObject({ state: 'NOT_RUN' });
    expect(await F.reviewJobError(ctx, 'staff', jobId, 'ACCEPT', 'op-w2')).toContain('Run screening before accepting');
  });

  it('request-changes needs no run', async () => {
    const jobId = await submit();
    const reviewed = await F.reviewJob(ctx, 'staff', jobId, 'REQUEST_EDITS', 'op-edits', 'Please revise the volumes.');
    expect(reviewed.state).toBe('CHANGES_REQUESTED');
  });
});
