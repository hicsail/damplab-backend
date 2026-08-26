import { ForbiddenException } from '@nestjs/common';
import { JobResolver } from './job.resolver';
import { JobState } from './job.model';
import { Role } from '../auth/roles/roles.enum';

describe('JobResolver.saveJobWorkflows customer edit gate', () => {
  const user: any = {
    sub: 'customer-1',
    email: 'customer@example.org',
    preferred_username: 'Customer',
    realm_access: { roles: [] }
  };

  function harness(state: JobState): { resolver: JobResolver; saveWorkflows: jest.Mock } {
    const job = {
      _id: 'job-1',
      name: 'Job',
      sub: user.sub,
      state,
      customerActionRequired: 'EDIT_WORKFLOW',
      workflows: []
    };
    const jobService: any = { findById: jest.fn(async () => job) };
    const saveWorkflows = jest.fn(async () => job);
    const jobVersionService: any = { saveWorkflows };
    const activityService: any = { createEvent: jest.fn(async () => undefined) };
    const sowService: any = { findByJobId: jest.fn(async () => null), syncServicesFromJobWorkflows: jest.fn(async () => undefined) };
    const resolver = new JobResolver(jobService, {} as any, {} as any, activityService, {} as any, sowService, {} as any, jobVersionService, {} as any, {} as any);
    return { resolver, saveWorkflows };
  }

  it.each([JobState.SUBMITTED, JobState.ACCEPTED])('rejects a stale true grant in %s', async (state) => {
    const { resolver, saveWorkflows } = harness(state);

    await expect(resolver.saveJobWorkflows({ jobId: 'job-1', workflows: [], note: 'edit' } as any, user)).rejects.toBeInstanceOf(ForbiddenException);
    expect(saveWorkflows).not.toHaveBeenCalled();
  });

  it('allows an explicit true grant in CHANGES_REQUESTED', async () => {
    const { resolver, saveWorkflows } = harness(JobState.CHANGES_REQUESTED);

    await resolver.saveJobWorkflows({ jobId: 'job-1', workflows: [], note: 'edit' } as any, user);

    expect(saveWorkflows).toHaveBeenCalledTimes(1);
  });
});

describe('JobResolver.restoreJobVersion', () => {
  const staff: any = {
    sub: 'staff-1',
    email: 'staff@example.org',
    preferred_username: 'Staff',
    realm_access: { roles: [Role.DamplabStaff] }
  };

  it('syncs the SOW billing core after restoring a version', async () => {
    const job = { _id: 'job-1', name: 'Job', sub: 'customer-1', state: JobState.SUBMITTED, workflows: [] };
    const restoreVersion = jest.fn(async () => job);
    const syncServicesFromJobWorkflows = jest.fn(async () => undefined);
    const resolver = new JobResolver(
      { findById: async () => job } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { syncServicesFromJobWorkflows } as any,
      {} as any,
      { restoreVersion } as any,
      {} as any,
      {} as any
    );

    await resolver.restoreJobVersion('job-1', 1000, staff, 'Back to 1.0');

    expect(restoreVersion).toHaveBeenCalledWith('job-1', 1000, expect.objectContaining({ role: 'STAFF', sub: staff.sub }), 'Back to 1.0');
    expect(syncServicesFromJobWorkflows).toHaveBeenCalledWith('job-1');
  });

  it('does not sync when restore is refused', async () => {
    const job = { _id: 'job-1', name: 'Job', sub: 'customer-1', state: JobState.CHANGES_REQUESTED, workflows: [] };
    const restoreVersion = jest.fn(async () => job);
    const syncServicesFromJobWorkflows = jest.fn(async () => undefined);
    const resolver = new JobResolver(
      { findById: async () => job } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { syncServicesFromJobWorkflows } as any,
      {} as any,
      { restoreVersion } as any,
      {} as any,
      {} as any
    );

    await expect(resolver.restoreJobVersion('job-1', 1000, staff, 'Back to 1.0')).rejects.toBeInstanceOf(ForbiddenException);
    expect(restoreVersion).not.toHaveBeenCalled();
    expect(syncServicesFromJobWorkflows).not.toHaveBeenCalled();
  });
});
