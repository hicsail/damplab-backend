import { ForbiddenException } from '@nestjs/common';
import { ScreeningRunResolver } from './screening-run.resolver';

const staff: any = { sub: 'staff-1', email: 's@bu.edu', preferred_username: 's', realm_access: { roles: ['damplab-staff'] } };
const JOB = '65a1b2c3d4e5f60718293a4b';

const build = (shows: boolean): { resolver: ScreeningRunResolver; runs: { findForJob: jest.Mock; findById: jest.Mock } } => {
  const runs = { findForJob: jest.fn(async () => [{ _id: 'r2' }, { _id: 'r1' }]), findById: jest.fn(async () => ({ _id: 'r1', aclid: { raw: { id: 'scr_1' } } })) };
  const keycloak = { userShowsBiosecurity: jest.fn(async () => shows) };
  return { resolver: new ScreeningRunResolver(runs as any, keycloak as any), runs };
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
