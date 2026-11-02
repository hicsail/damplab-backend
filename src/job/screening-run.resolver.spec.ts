import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ScreeningRunResolver } from './screening-run.resolver';

const staff: any = { sub: 'staff-1', email: 's@bu.edu', preferred_username: 's', realm_access: { roles: ['damplab-staff'] } };
const JOB = '65a1b2c3d4e5f60718293a4b';

const build = (
  shows: boolean,
  job: unknown = { _id: JOB, state: 1 }
): { resolver: ScreeningRunResolver; runs: { findForJob: jest.Mock; findById: jest.Mock }; jobScreening: { acceptanceScreening: jest.Mock }; jobService: { findById: jest.Mock } } => {
  const runs = { findForJob: jest.fn(async () => [{ _id: 'r2' }, { _id: 'r1' }]), findById: jest.fn(async () => ({ _id: 'r1', aclid: { raw: { id: 'scr_1' } } })) };
  const keycloak = { userShowsBiosecurity: jest.fn(async () => shows) };
  const jobScreening = { acceptanceScreening: jest.fn<Promise<any>, any[]>(async () => ({ state: 'NOT_RUN', message: 'not screened' })) };
  const jobService = { findById: jest.fn(async () => job) };
  return { resolver: new ScreeningRunResolver(runs as any, keycloak as any, jobScreening as any, jobService as any), runs, jobScreening, jobService };
};

describe('ScreeningRunResolver (biosecurity-update behaviours 8, 9)', () => {
  it('lists a job’s runs as the service orders them (newest first)', async () => {
    const { resolver, runs } = build(true);
    await expect(resolver.jobScreeningRuns(JOB, staff)).resolves.toEqual([{ _id: 'r2' }, { _id: 'r1' }]);
    expect(runs.findForJob).toHaveBeenCalledWith(JOB);
  });

  it('returns one run with its raw report', async () => {
    const { resolver } = build(true);
    await expect(resolver.screeningRun('r1', staff)).resolves.toMatchObject({ aclid: { raw: { id: 'scr_1' } } });
  });

  it('refuses staff whose showBiosecurity is false, before reading anything', async () => {
    const { resolver, runs } = build(false);
    await expect(resolver.jobScreeningRuns(JOB, staff)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(resolver.screeningRun('r1', staff)).rejects.toBeInstanceOf(ForbiddenException);
    expect(runs.findForJob).not.toHaveBeenCalled();
    expect(runs.findById).not.toHaveBeenCalled();
  });
});

describe('ScreeningRunResolver.jobAcceptanceScreening (aclid-customer-screening behaviours 7, 14)', () => {
  it("returns the service's answer", async () => {
    const { resolver, jobScreening } = build(true);
    await expect(resolver.jobAcceptanceScreening(JOB, staff)).resolves.toEqual({ state: 'NOT_RUN', message: 'not screened' });
    expect(jobScreening.acceptanceScreening).toHaveBeenCalledWith({ _id: JOB, state: 1 }, { callerCanScreen: true });
  });

  it('answers staff whose showBiosecurity is false, with callerCanScreen false', async () => {
    const { resolver, jobScreening } = build(false);
    await expect(resolver.jobAcceptanceScreening(JOB, staff)).resolves.toMatchObject({ state: 'NOT_RUN' });
    expect(jobScreening.acceptanceScreening).toHaveBeenCalledWith(expect.anything(), { callerCanScreen: false });
  });

  it('NotFound for a missing job', async () => {
    const { resolver, jobScreening } = build(true, null);
    await expect(resolver.jobAcceptanceScreening(JOB, staff)).rejects.toBeInstanceOf(NotFoundException);
    expect(jobScreening.acceptanceScreening).not.toHaveBeenCalled();
  });
});
