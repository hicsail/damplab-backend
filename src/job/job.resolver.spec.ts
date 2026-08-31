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
    const resolver = new JobResolver(jobService, {} as any, {} as any, activityService, {} as any, sowService, {} as any, jobVersionService, {} as any, {} as any, {} as any);
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
      {} as any,
      {} as any
    );

    await expect(resolver.restoreJobVersion('job-1', 1000, staff, 'Back to 1.0')).rejects.toBeInstanceOf(ForbiddenException);
    expect(restoreVersion).not.toHaveBeenCalled();
    expect(syncServicesFromJobWorkflows).not.toHaveBeenCalled();
  });
});

/**
 * The security-relevant half of the merged jobs page.
 *
 * `/dashboard` now serves both a client and a technician, so the route no longer
 * decides whose jobs come back — this does. A client sending `scope: ALL` (which is
 * what the page sends by default) must silently get their own jobs, and must not be
 * able to reach another client's by naming them.
 */
describe('JobResolver.jobsForViewer — scope is enforced, not offered', () => {
  const viewer = (roles: string[], sub = 'viewer-1'): any => ({ sub, email: 'v@example.org', preferred_username: 'V', realm_access: { roles } });

  // Untyped `jest.Mock` so `mock.calls[0][1]` — the resolved scope, which is what
  // these tests are actually about — is reachable.
  const harness = (): { resolver: JobResolver; findJobsForViewer: jest.Mock } => {
    const findJobsForViewer: jest.Mock = jest.fn().mockResolvedValue({ items: [], totalCount: 0 });
    const resolver = new JobResolver({ findJobsForViewer } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { resolver, findJobsForViewer };
  };

  it('forces a client to their own jobs even when they ask for ALL', async () => {
    const { resolver, findJobsForViewer } = harness();
    await resolver.jobsForViewer({ scope: 'ALL' } as any, viewer([]));
    expect(findJobsForViewer.mock.calls[0][1]).toEqual(expect.objectContaining({ scope: 'CREATED_BY_ME', viewerSub: 'viewer-1' }));
  });

  it("drops a client's attempt to name someone else as the creator", async () => {
    // The interesting attack: not asking for ALL, but asking for one specific
    // other person's jobs.
    const { resolver, findJobsForViewer } = harness();
    await resolver.jobsForViewer({ scope: 'ALL', createdBySub: 'someone-else' } as any, viewer([]));
    expect(findJobsForViewer.mock.calls[0][1]).toEqual(expect.objectContaining({ scope: 'CREATED_BY_ME', createdBySub: undefined, assigneeId: undefined }));
  });

  it('does not error on an over-broad request — it narrows it', async () => {
    // Erroring would break the page for every client, since ALL is what it sends
    // by default. The rule is "silently return only yours", not "refuse".
    const { resolver } = harness();
    await expect(resolver.jobsForViewer({ scope: 'ALL' } as any, viewer([]))).resolves.toEqual({ items: [], totalCount: 0 });
  });

  it('honours ALL and both filters for a caller holding jobs:view-all', async () => {
    const { resolver, findJobsForViewer } = harness();
    await resolver.jobsForViewer({ scope: 'ALL', createdBySub: 'client-9', assigneeId: 'tech-3' } as any, viewer([Role.Technician]));
    expect(findJobsForViewer.mock.calls[0][1]).toEqual(expect.objectContaining({ scope: 'ALL', createdBySub: 'client-9', assigneeId: 'tech-3' }));
  });

  it('defaults a staff caller to ALL and a client to their own, with no scope sent', async () => {
    const staffHarness = harness();
    await staffHarness.resolver.jobsForViewer(null, viewer([Role.DamplabStaff]));
    expect(staffHarness.findJobsForViewer.mock.calls[0][1]).toEqual(expect.objectContaining({ scope: 'ALL' }));

    const clientHarness = harness();
    await clientHarness.resolver.jobsForViewer(null, viewer([]));
    expect(clientHarness.findJobsForViewer.mock.calls[0][1]).toEqual(expect.objectContaining({ scope: 'CREATED_BY_ME' }));
  });

  it('resolves WORKED_BY_ME against the viewer, never against a client-supplied sub', async () => {
    const { resolver, findJobsForViewer } = harness();
    await resolver.jobsForViewer({ scope: 'WORKED_BY_ME' } as any, viewer([Role.Technician], 'tech-7'));
    expect(findJobsForViewer.mock.calls[0][1]).toEqual(expect.objectContaining({ scope: 'WORKED_BY_ME', viewerSub: 'tech-7' }));
  });
});
