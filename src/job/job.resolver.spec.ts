import { ForbiddenException } from '@nestjs/common';
import { JobResolver } from './job.resolver';
import { JobState } from './job.model';

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
    const sowService: any = { findByJobId: jest.fn(async () => null) };
    const resolver = new JobResolver(jobService, {} as any, {} as any, activityService, {} as any, sowService, {} as any, {} as any, jobVersionService, {} as any, {} as any);
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
