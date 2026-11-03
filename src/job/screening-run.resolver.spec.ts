import { NotFoundException } from '@nestjs/common';
import { ScreeningRunResolver } from './screening-run.resolver';

const JOB = '65a1b2c3d4e5f60718293a4b';

const build = (
  job: unknown = { _id: JOB, state: 1 }
): { resolver: ScreeningRunResolver; runs: { findForJob: jest.Mock; findById: jest.Mock }; jobScreening: { acceptanceScreening: jest.Mock }; jobService: { findById: jest.Mock } } => {
  const runs = { findForJob: jest.fn(async () => [{ _id: 'r2' }, { _id: 'r1' }]), findById: jest.fn(async () => ({ _id: 'r1', aclid: { raw: { id: 'scr_1' } } })) };
  const jobScreening = { acceptanceScreening: jest.fn<Promise<any>, any[]>(async () => ({ state: 'NOT_RUN', message: 'not screened' })) };
  const jobService = { findById: jest.fn(async () => job) };
  return { resolver: new ScreeningRunResolver(runs as any, jobScreening as any, jobService as any), runs, jobScreening, jobService };
};

describe('ScreeningRunResolver (biosecurity-update behaviours 8, 9)', () => {
  it('lists a job’s runs as the service orders them (newest first)', async () => {
    const { resolver, runs } = build();
    await expect(resolver.jobScreeningRuns(JOB)).resolves.toEqual([{ _id: 'r2' }, { _id: 'r1' }]);
    expect(runs.findForJob).toHaveBeenCalledWith(JOB);
  });

  it('returns one run with its raw report', async () => {
    const { resolver } = build();
    await expect(resolver.screeningRun('r1')).resolves.toMatchObject({ aclid: { raw: { id: 'scr_1' } } });
  });
});

describe('ScreeningRunResolver.jobAcceptanceScreening (aclid-customer-screening behaviours 7, 14)', () => {
  it("returns the service's answer", async () => {
    const { resolver, jobScreening } = build();
    await expect(resolver.jobAcceptanceScreening(JOB)).resolves.toEqual({ state: 'NOT_RUN', message: 'not screened' });
    expect(jobScreening.acceptanceScreening).toHaveBeenCalledWith({ _id: JOB, state: 1 });
    expect(jobScreening.acceptanceScreening.mock.calls[0]).toHaveLength(1);
  });

  it('NotFound for a missing job', async () => {
    const { resolver, jobScreening } = build(null);
    await expect(resolver.jobAcceptanceScreening(JOB)).rejects.toBeInstanceOf(NotFoundException);
    expect(jobScreening.acceptanceScreening).not.toHaveBeenCalled();
  });
});
