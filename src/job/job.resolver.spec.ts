import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { JobResolver } from './job.resolver';
import { CustomerCategory, HomologyScreeningStatus, JobState } from './job.model';
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
    const jobService: any = { findById: jest.fn(async () => job), claimSubIfPrimary: jest.fn(async (j: any) => j) };
    const saveWorkflows = jest.fn(async () => job);
    const jobVersionService: any = { saveWorkflows };
    const activityService: any = { createEvent: jest.fn(async () => undefined) };
    const sowService: any = { findByJobId: jest.fn(async () => null), syncServicesFromJobWorkflows: jest.fn(async () => undefined) };
    const resolver = new JobResolver(jobService, {} as any, {} as any, activityService, {} as any, sowService, {} as any, jobVersionService, {} as any, {} as any, {} as any, {} as any, {} as any);
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

  it('names the caller as the uploader, so the version service checks spreadsheet keys', async () => {
    const { resolver, saveWorkflows } = harness(JobState.CHANGES_REQUESTED);
    await resolver.saveJobWorkflows({ jobId: 'job-1', workflows: [], note: 'edit' } as any, user);
    expect(saveWorkflows).toHaveBeenCalledWith(expect.anything(), expect.anything(), { uploaderSub: 'customer-1' });
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
    const resolver = new JobResolver({ findJobsForViewer } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { resolver, findJobsForViewer };
  };

  it('forces a client to their own jobs even when they ask for ALL', async () => {
    const { resolver, findJobsForViewer } = harness();
    await resolver.jobsForViewer({ scope: 'ALL' } as any, viewer([]));
    expect(findJobsForViewer.mock.calls[0][1]).toEqual(expect.objectContaining({ scope: 'CREATED_BY_ME', viewerSub: 'viewer-1' }));
  });

  it("passes the viewer's email, so staff-submitted jobs reach the client named on them", async () => {
    // The regression this pins: `jobsForViewer` was added alongside the existing
    // `ownJobs` and inherited only half of it. `ownJobs` had already learned to
    // match `clientEmail`; the new path forwarded `sub` alone, so a client's
    // dashboard silently dropped every job staff had submitted for them.
    const { resolver, findJobsForViewer } = harness();
    await resolver.jobsForViewer({ scope: 'ALL' } as any, viewer([]));
    expect(findJobsForViewer.mock.calls[0][1]).toEqual(expect.objectContaining({ viewerEmail: 'v@example.org' }));
  });

  it("drops a client's attempt to name someone else as the creator", async () => {
    // The interesting attack: not asking for ALL, but asking for one specific
    // other person's jobs.
    const { resolver, findJobsForViewer } = harness();
    await resolver.jobsForViewer({ scope: 'ALL', createdBySub: 'someone-else', createdByClient: 'someone@else.org' } as any, viewer([]));
    expect(findJobsForViewer.mock.calls[0][1]).toEqual(expect.objectContaining({ scope: 'CREATED_BY_ME', createdBySub: undefined, createdByClient: undefined, assigneeId: undefined }));
  });

  it('does not error on an over-broad request — it narrows it', async () => {
    // Erroring would break the page for every client, since ALL is what it sends
    // by default. The rule is "silently return only yours", not "refuse".
    const { resolver } = harness();
    await expect(resolver.jobsForViewer({ scope: 'ALL' } as any, viewer([]))).resolves.toEqual({ items: [], totalCount: 0 });
  });

  it('honours ALL and both filters for a caller holding jobs:view-all', async () => {
    const { resolver, findJobsForViewer } = harness();
    await resolver.jobsForViewer({ scope: 'ALL', createdBySub: 'client-9', createdByClient: 'jane@bu.edu', assigneeId: 'tech-3' } as any, viewer([Role.Technician]));
    expect(findJobsForViewer.mock.calls[0][1]).toEqual(expect.objectContaining({ scope: 'ALL', createdBySub: 'client-9', createdByClient: 'jane@bu.edu', assigneeId: 'tech-3' }));
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

function screeningHarness(overrides: { created?: { _id: string; name: string }; findById?: jest.Mock } = {}): {
  resolver: JobResolver;
  screenJobInBackground: jest.Mock;
  screenJob: jest.Mock;
  findById: jest.Mock;
} {
  const created = overrides.created ?? { _id: 'job-1', name: 'Submitted job' };
  const findById = overrides.findById ?? jest.fn(async () => created);
  const jobService: any = {
    create: jest.fn(async () => created),
    findById
  };
  const jobVersionService: any = {
    snapshotLiveWorkflows: jest.fn(async () => []),
    appendVersion: jest.fn(async () => undefined)
  };
  const activityService: any = { createEvent: jest.fn(async () => undefined) };
  const keycloakService: any = { resolveCustomerCategoryForUser: jest.fn(async () => undefined) };
  const notificationDispatch: any = { dispatch: jest.fn() };
  const screenJobInBackground = jest.fn();
  const screenJob = jest.fn();
  const jobScreeningService: any = { screenJobInBackground, screenJob };
  const resolver = new JobResolver(
    jobService,
    {} as any,
    {} as any,
    activityService,
    {} as any,
    {} as any,
    {} as any,
    jobVersionService,
    {} as any,
    keycloakService,
    notificationDispatch,
    jobScreeningService,
    {} as any
  );
  return { resolver, screenJobInBackground, screenJob, findById };
}

describe('JobResolver.createJob — homology screening dispatch', () => {
  const user: any = {
    sub: 'customer-9',
    email: 'c@example.org',
    preferred_username: 'Customer',
    realm_access: { roles: [] }
  };

  it('starts screening in the background with the new job id and the submitter, and does not wait for a verdict', async () => {
    const { resolver, screenJobInBackground, screenJob } = screeningHarness();

    const created = await resolver.createJob({ name: 'Submitted job', workflows: [] } as any, user);

    expect(created._id).toBe('job-1');
    expect(screenJobInBackground).toHaveBeenCalledWith('job-1', 'customer-9');
    expect(screenJob).not.toHaveBeenCalled();
  });
});

describe('JobResolver.rerunJobHomologyScreening', () => {
  const staff: any = {
    sub: 'staff-1',
    email: 'staff@example.org',
    preferred_username: 'Staff',
    realm_access: { roles: [Role.DamplabStaff] }
  };

  it('awaits a new screen and returns the job with the recorded verdict', async () => {
    const job = { _id: 'job-1', name: 'Job' };
    const screened = { ...job, homologyScreening: { status: 'PASSED' } };
    const findById = jest.fn().mockResolvedValueOnce(job).mockResolvedValueOnce(screened);
    const { resolver, screenJob, screenJobInBackground } = screeningHarness({ findById });
    screenJob.mockResolvedValue({ status: 'PASSED' });

    const result = await resolver.rerunJobHomologyScreening('job-1', staff);

    expect(screenJob).toHaveBeenCalledWith('job-1', 'staff-1');
    expect(screenJobInBackground).not.toHaveBeenCalled();
    expect(result).toBe(screened);
  });

  it('throws when the job is missing, without calling SecureDNA', async () => {
    const findById = jest.fn(async () => null);
    const { resolver, screenJob } = screeningHarness({ findById });

    await expect(resolver.rerunJobHomologyScreening('missing', staff)).rejects.toBeInstanceOf(NotFoundException);
    expect(screenJob).not.toHaveBeenCalled();
  });
});

/**
 * The customer's KYC path. Both mutations are gated on the baseline `jobs:view`
 * (see resolver-gates.spec.ts), so the access rule lives inside: the job's owner,
 * the client named on it, or anyone holding jobs:view-all.
 */
function kycHarness(job: any): {
  resolver: JobResolver;
  createVerificationUrl: jest.Mock;
  getScreen: jest.Mock;
  setAclidScreening: jest.Mock;
  setHomologyScreening: jest.Mock;
  screenJob: jest.Mock;
  screenJobInBackground: jest.Mock;
} {
  const findById = jest.fn(async () => job);
  const setAclidScreening = jest.fn(async (_id: string, aclidScreening: any) => ({ ...job, aclidScreening }));
  const setHomologyScreening = jest.fn(async (_id: string, homologyScreening: any) => ({ ...job, homologyScreening }));
  const jobService: any = { findById, setAclidScreening, setHomologyScreening };
  const createVerificationUrl = jest.fn(async () => 'https://verify.aclid.bio/session/abc');
  const getScreen = jest.fn();
  const aclidService: any = { createVerificationUrl, getScreen };
  const screenJob = jest.fn();
  const screenJobInBackground = jest.fn();
  const jobScreeningService: any = { screenJob, screenJobInBackground };
  const resolver = new JobResolver(jobService, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, jobScreeningService, aclidService);
  return { resolver, createVerificationUrl, getScreen, setAclidScreening, setHomologyScreening, screenJob, screenJobInBackground };
}

const screenedJob = (): any => ({
  _id: 'job-1',
  name: 'Job',
  sub: 'customer-1',
  clientEmail: 'named@bu.edu',
  aclidScreening: {
    screenId: 'scr_123',
    homologyStatus: HomologyScreeningStatus.PASSED,
    regulatoryStatus: 'not_controlled',
    verificationStatus: 'pending',
    decisionStatus: 'pending',
    verificationCompletedAt: null,
    sequenceCount: 2,
    startedAt: new Date('2026-09-01T00:00:00Z'),
    completedAt: new Date('2026-09-01T00:01:00Z'),
    detail: null,
    customerStatus: HomologyScreeningStatus.IN_PROGRESS
  },
  // The stored rollup. SecureDNA's leg is not recoverable from it.
  homologyScreening: {
    status: HomologyScreeningStatus.PASSED,
    startedAt: new Date('2026-09-01T00:00:00Z'),
    completedAt: new Date('2026-09-01T00:02:00Z'),
    batchId: 'batch-1',
    sequenceCount: 2,
    detail: 'SecureDNA backup after Aclid error: screen failed without a regulatory status'
  }
});

const owner: any = { sub: 'customer-1', email: 'owner@example.org', preferred_username: 'Owner', realm_access: { roles: [] } };
const namedClient: any = { sub: 'client-7', email: 'Named@BU.edu', preferred_username: 'Named', realm_access: { roles: [] } };
const technician: any = { sub: 'tech-1', email: 'tech@example.org', preferred_username: 'Tech', realm_access: { roles: [Role.Technician] } };
const stranger: any = { sub: 'stranger', email: 'stranger@example.org', preferred_username: 'Stranger', realm_access: { roles: [] } };

describe('JobResolver.startJobCustomerVerification', () => {
  const previousBase = process.env.APP_BASE_URL;
  afterEach(() => {
    if (previousBase === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousBase;
  });

  it('mints a verification url for the owner, sending the customer back to their job page', async () => {
    process.env.APP_BASE_URL = 'https://canvas.example.org/';
    const { resolver, createVerificationUrl } = kycHarness(screenedJob());

    const session = await resolver.startJobCustomerVerification('job-1', owner);

    expect(session).toEqual({ url: 'https://verify.aclid.bio/session/abc' });
    expect(createVerificationUrl).toHaveBeenCalledWith({ screenId: 'scr_123', redirectUrl: 'https://canvas.example.org/client_view/job-1' });
  });

  it('sends a relative redirect when APP_BASE_URL is not set', async () => {
    delete process.env.APP_BASE_URL;
    const { resolver, createVerificationUrl } = kycHarness(screenedJob());

    await resolver.startJobCustomerVerification('job-1', owner);

    expect(createVerificationUrl).toHaveBeenCalledWith({ screenId: 'scr_123', redirectUrl: '/client_view/job-1' });
  });

  it('admits the client named on a staff-submitted job, and anyone with jobs:view-all', async () => {
    const named = kycHarness(screenedJob());
    await expect(named.resolver.startJobCustomerVerification('job-1', namedClient)).resolves.toEqual({ url: expect.any(String) });

    const staff = kycHarness(screenedJob());
    await expect(staff.resolver.startJobCustomerVerification('job-1', technician)).resolves.toEqual({ url: expect.any(String) });
  });

  it('refuses a stranger without touching Aclid', async () => {
    const { resolver, createVerificationUrl } = kycHarness(screenedJob());

    await expect(resolver.startJobCustomerVerification('job-1', stranger)).rejects.toBeInstanceOf(ForbiddenException);
    expect(createVerificationUrl).not.toHaveBeenCalled();
  });

  it('404s on a missing job', async () => {
    const { resolver, createVerificationUrl } = kycHarness(null);

    await expect(resolver.startJobCustomerVerification('missing', owner)).rejects.toBeInstanceOf(NotFoundException);
    expect(createVerificationUrl).not.toHaveBeenCalled();
  });

  it('refuses a job with no Aclid screen to hang the verification off', async () => {
    const job = screenedJob();
    job.aclidScreening.screenId = null;
    const { resolver, createVerificationUrl } = kycHarness(job);

    await expect(resolver.startJobCustomerVerification('job-1', owner)).rejects.toThrow(new BadRequestException('No Aclid screen on this job'));
    expect(createVerificationUrl).not.toHaveBeenCalled();
  });

  it('refuses a job that was never screened by Aclid', async () => {
    const unscreened = screenedJob();
    delete unscreened.aclidScreening;
    const { resolver } = kycHarness(unscreened);

    await expect(resolver.startJobCustomerVerification('job-1', owner)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('JobResolver.refreshJobAclidScreening', () => {
  const approvedScreen = {
    id: 'scr_123',
    status: 'succeeded',
    regulatoryStatus: 'not_controlled',
    verificationStatus: 'verified',
    decisionStatus: 'approved',
    verificationCompletedAt: '2026-09-02T10:00:00.000Z',
    findings: null
  };

  it('re-reads the screen and rewrites the KYC fields, homology and customer status', async () => {
    const { resolver, getScreen, setAclidScreening, screenJob, screenJobInBackground } = kycHarness(screenedJob());
    getScreen.mockResolvedValue(approvedScreen);

    const updated = await resolver.refreshJobAclidScreening('job-1', owner);

    expect(getScreen).toHaveBeenCalledWith('scr_123');
    expect(setAclidScreening).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        screenId: 'scr_123',
        regulatoryStatus: 'not_controlled',
        verificationStatus: 'verified',
        decisionStatus: 'approved',
        verificationCompletedAt: new Date('2026-09-02T10:00:00.000Z'),
        homologyStatus: HomologyScreeningStatus.PASSED,
        customerStatus: HomologyScreeningStatus.PASSED,
        // Untouched: these describe the screen that was created, not its outcome.
        sequenceCount: 2,
        startedAt: new Date('2026-09-01T00:00:00Z')
      })
    );
    expect(updated.aclidScreening?.decisionStatus).toBe('approved');
    // A refresh is a read of Aclid's state, never a new screen.
    expect(screenJob).not.toHaveBeenCalled();
    expect(screenJobInBackground).not.toHaveBeenCalled();
  });

  it('records a rejection as FAILED for the customer and a controlled verdict as FAILED homology', async () => {
    const { resolver, getScreen, setAclidScreening } = kycHarness(screenedJob());
    getScreen.mockResolvedValue({ ...approvedScreen, regulatoryStatus: 'controlled', decisionStatus: 'rejected' });

    await resolver.refreshJobAclidScreening('job-1', owner);

    expect(setAclidScreening).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ homologyStatus: HomologyScreeningStatus.FAILED, customerStatus: HomologyScreeningStatus.FAILED, decisionStatus: 'rejected' })
    );
  });

  /**
   * The rollup is stored, not derived, and SecureDNA's leg cannot be recovered
   * from it. So a screen that first came back with no regulatory status (and got
   * a SecureDNA backup Passed) and later reads `controlled` has to fail the
   * Homology row here, without re-screening anything.
   */
  it('fails the stored Homology rollup when Aclid now says controlled, without re-screening', async () => {
    const job = screenedJob();
    job.homologyScreening.status = HomologyScreeningStatus.PASSED;
    const { resolver, getScreen, setHomologyScreening, screenJob, screenJobInBackground } = kycHarness(job);
    getScreen.mockResolvedValue({ ...approvedScreen, regulatoryStatus: 'controlled' });

    const updated = await resolver.refreshJobAclidScreening('job-1', owner);

    expect(setHomologyScreening).toHaveBeenCalledTimes(1);
    expect(setHomologyScreening).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({
        status: HomologyScreeningStatus.FAILED,
        detail: expect.stringMatching(/Aclid.*controlled/),
        // The SecureDNA run that produced the row is still the row's provenance.
        batchId: 'batch-1',
        startedAt: new Date('2026-09-01T00:00:00Z'),
        sequenceCount: 2
      })
    );
    expect(updated.homologyScreening?.status).toBe(HomologyScreeningStatus.FAILED);
    expect(screenJob).not.toHaveBeenCalled();
    expect(screenJobInBackground).not.toHaveBeenCalled();
  });

  it('never promotes the Homology rollup from a later Aclid grant', async () => {
    // A FAILED rollup may be SecureDNA's verdict, which this refresh knows
    // nothing about. Only Aclid's own FAILED is allowed to move the row.
    const job = screenedJob();
    job.homologyScreening.status = HomologyScreeningStatus.FAILED;
    const { resolver, getScreen, setHomologyScreening } = kycHarness(job);
    getScreen.mockResolvedValue(approvedScreen);

    await resolver.refreshJobAclidScreening('job-1', owner);

    expect(setHomologyScreening).not.toHaveBeenCalled();
  });

  it('leaves the Homology rollup alone when Aclid still has no verdict', async () => {
    const { resolver, getScreen, setHomologyScreening } = kycHarness(screenedJob());
    getScreen.mockResolvedValue({ ...approvedScreen, status: 'failed', regulatoryStatus: null });

    await resolver.refreshJobAclidScreening('job-1', owner);

    expect(setHomologyScreening).not.toHaveBeenCalled();
  });

  it('writes a FAILED Homology row even when the job never had one', async () => {
    const job = screenedJob();
    delete job.homologyScreening;
    const { resolver, getScreen, setHomologyScreening } = kycHarness(job);
    getScreen.mockResolvedValue({ ...approvedScreen, regulatoryStatus: 'controlled' });

    await resolver.refreshJobAclidScreening('job-1', owner);

    expect(setHomologyScreening).toHaveBeenCalledWith('job-1', expect.objectContaining({ status: HomologyScreeningStatus.FAILED, sequenceCount: 2, batchId: null }));
  });

  it('refuses a stranger without calling Aclid', async () => {
    const { resolver, getScreen, setAclidScreening } = kycHarness(screenedJob());

    await expect(resolver.refreshJobAclidScreening('job-1', stranger)).rejects.toBeInstanceOf(ForbiddenException);
    expect(getScreen).not.toHaveBeenCalled();
    expect(setAclidScreening).not.toHaveBeenCalled();
  });

  it('404s on a missing job and rejects a job with no screen', async () => {
    await expect(kycHarness(null).resolver.refreshJobAclidScreening('missing', owner)).rejects.toBeInstanceOf(NotFoundException);

    const job = screenedJob();
    job.aclidScreening.screenId = null;
    const { resolver, getScreen } = kycHarness(job);
    await expect(resolver.refreshJobAclidScreening('job-1', owner)).rejects.toThrow(new BadRequestException('No Aclid screen on this job'));
    expect(getScreen).not.toHaveBeenCalled();
  });
});

describe('JobResolver.createJob — clients, members and description', () => {
  const customer: any = { sub: 'customer-9', email: 'Customer@Example.org', preferred_username: 'Customer', realm_access: { roles: [] } };
  const admin: any = { sub: 'admin-1', email: 'tech@bu.edu', preferred_username: 'Tech', realm_access: { roles: [Role.DamplabStaff] } };

  function harness(account: any = { sub: 'client-kc', username: 'cara', customerCategory: CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC }): {
    resolver: JobResolver;
    create: jest.Mock;
    byUser: jest.Mock;
    byEmail: jest.Mock;
  } {
    const create = jest.fn(async (input: any) => ({ _id: 'job-1', name: input.name, ...input }));
    const jobService: any = { create, findById: jest.fn(async () => ({ _id: 'job-1', name: 'Job' })) };
    const jobVersionService: any = { snapshotLiveWorkflows: jest.fn(async () => []), appendVersion: jest.fn(async () => undefined) };
    const activityService: any = { createEvent: jest.fn(async () => undefined) };
    const byUser = jest.fn(async () => CustomerCategory.INTERNAL_CUSTOMERS);
    const byEmail = jest.fn(async () => account);
    const keycloakService: any = { resolveCustomerCategoryForUser: byUser, resolveClientAccountByEmail: byEmail };
    const jobScreeningService: any = { screenJobInBackground: jest.fn(), screenJob: jest.fn() };
    const resolver = new JobResolver(
      jobService,
      {} as any,
      {} as any,
      activityService,
      {} as any,
      {} as any,
      {} as any,
      jobVersionService,
      {} as any,
      keycloakService,
      { dispatch: jest.fn() } as any,
      jobScreeningService,
      {} as any
    );
    return { resolver, create, byUser, byEmail };
  }

  it('refuses clientEmail from a caller without job:submit-for-client, before writing anything (F2)', async () => {
    const { resolver, create, byEmail } = harness();
    await expect(resolver.createJob({ name: 'J', workflows: [], clientEmail: 'client@bu.edu' } as any, customer)).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
    expect(byEmail).not.toHaveBeenCalled();
  });

  it("makes a staff-submitted job the client's: their sub, email, username and category, with staff recorded as submitter only (B28, F3, B11)", async () => {
    const { resolver, create, byUser, byEmail } = harness();
    await resolver.createJob({ name: 'J', workflows: [], clientEmail: 'client@bu.edu', memberEmails: ['B@x.org', 'client@bu.edu', 'b@x.org'] } as any, admin);
    expect(byEmail).toHaveBeenCalledTimes(1);
    expect(byEmail).toHaveBeenCalledWith('client@bu.edu');
    expect(byUser).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0]).toMatchObject({
      sub: 'client-kc',
      email: 'client@bu.edu',
      username: 'cara',
      clientEmail: 'client@bu.edu',
      memberEmails: ['b@x.org'],
      customerCategory: CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC,
      submittedBy: { sub: 'admin-1', email: 'tech@bu.edu', name: 'Tech' }
    });
  });

  it('leaves sub and username unset when the client has no account (ownership rests on the email)', async () => {
    const { resolver, create } = harness({});
    await resolver.createJob({ name: 'J', workflows: [], clientEmail: 'new@bu.edu' } as any, admin);
    const input = create.mock.calls[0][0];
    expect(input.sub).toBeUndefined();
    expect(input.username).toBeUndefined();
    expect(input.email).toBe('new@bu.edu');
    expect(input.customerCategory).toBeUndefined();
  });

  it("lets any submitter add members; the submitter's own email is dropped (B10, B12)", async () => {
    const { resolver, create, byUser } = harness();
    await resolver.createJob({ name: 'J', workflows: [], memberEmails: [' Friend@X.org ', 'customer@example.org'], description: 'For lab 4' } as any, customer);
    expect(byUser).toHaveBeenCalled();
    expect(create.mock.calls[0][0]).toMatchObject({
      sub: 'customer-9',
      email: 'Customer@Example.org',
      memberEmails: ['friend@x.org'],
      description: 'For lab 4',
      customerCategory: CustomerCategory.INTERNAL_CUSTOMERS
    });
    expect(create.mock.calls[0][0].submittedBy).toBeUndefined();
  });

  it('allows an empty member list', async () => {
    const { resolver, create } = harness();
    await resolver.createJob({ name: 'J', workflows: [] } as any, customer);
    expect(create.mock.calls[0][0].memberEmails).toEqual([]);
  });

  it('rejects a malformed member email', async () => {
    const { resolver, create } = harness();
    await expect(resolver.createJob({ name: 'J', workflows: [], memberEmails: ['nope'] } as any, customer)).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('JobResolver resolve fields — memberEmails and primaryClientEmail', () => {
  const resolver = new JobResolver({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

  it('resolves a legacy row from the list pipeline that has no memberEmails at all', () => {
    const legacy: any = { sub: 's', email: 'Owner@x.org' };
    expect(resolver.memberEmails(legacy)).toEqual([]);
    expect(resolver.primaryClientEmail(legacy)).toBe('owner@x.org');
  });

  it('names the client as primary on a (legacy, unmigrated) staff-submitted job and never lists it as a member', () => {
    const job: any = { sub: 's', email: 'tech@bu.edu', clientEmail: 'client@bu.edu', memberEmails: ['client@bu.edu', 'b@x.org'] };
    expect(resolver.primaryClientEmail(job)).toBe('client@bu.edu');
    expect(resolver.memberEmails(job)).toEqual(['b@x.org']);
  });
});

describe('JobResolver — client ownership consequences (B29, B31)', () => {
  const client: any = { sub: 'client-kc', email: 'client@bu.edu', preferred_username: 'cara', realm_access: { roles: [] } };

  it('ownJobById claims the sub for the primary client and returns the claimed job', async () => {
    const job: any = { _id: 'job-1', email: 'client@bu.edu', clientEmail: 'client@bu.edu', submittedBy: { sub: 'admin-1' } };
    const claimSubIfPrimary = jest.fn(async (j: any, u: any) => ({ ...j, sub: u.sub }));
    const resolver = new JobResolver(
      { findById: async () => job, claimSubIfPrimary } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    expect((await resolver.ownJobById('job-1', client))?.sub).toBe('client-kc');
    expect(claimSubIfPrimary).toHaveBeenCalledWith(job, client);
  });

  it('refuses the staff submitter on ownJobById — submittedBy grants nothing (B28)', async () => {
    const job: any = { _id: 'job-1', sub: 'client-kc', email: 'client@bu.edu', clientEmail: 'client@bu.edu', submittedBy: { sub: 'admin-1', email: 'tech@bu.edu' } };
    const resolver = new JobResolver(
      { findById: async () => job, claimSubIfPrimary: async (j: any) => j } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    expect(await resolver.ownJobById('job-1', { sub: 'admin-1', email: 'tech@bu.edu', realm_access: { roles: [] } } as any)).toBeNull();
  });

  it("changeJobCustomerCategory updates the client's Keycloak account, not the staff submitter's (B31)", async () => {
    const job: any = { _id: 'job-1', sub: 'client-kc', email: 'client@bu.edu', clientEmail: 'client@bu.edu', submittedBy: { sub: 'admin-1' } };
    const setUserCustomerCategory = jest.fn(async () => undefined);
    const updateCustomerCategoryForSub = jest.fn(async () => [job]);
    const resolver = new JobResolver(
      { findById: async () => job, updateCustomerCategoryForSub } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { syncServicesFromJobWorkflows: jest.fn(async () => undefined) } as any,
      {} as any,
      {} as any,
      {} as any,
      { isConfigured: () => true, setUserCustomerCategory } as any,
      {} as any,
      {} as any,
      {} as any
    );
    await resolver.changeJobCustomerCategory('job-1', CustomerCategory.INTERNAL_CUSTOMERS);
    expect(setUserCustomerCategory).toHaveBeenCalledWith('client-kc', CustomerCategory.INTERNAL_CUSTOMERS);
    expect(updateCustomerCategoryForSub).toHaveBeenCalledWith('client-kc', CustomerCategory.INTERNAL_CUSTOMERS);
  });

  it('staff "created by me" also finds jobs they submitted for a client; a client never gets that widening', async () => {
    const findJobsForViewer: jest.Mock = jest.fn(async () => ({ items: [], totalCount: 0 }));
    const resolver = new JobResolver({ findJobsForViewer } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    await resolver.jobsForViewer({ scope: 'CREATED_BY_ME' } as any, { sub: 'admin-1', email: 'tech@bu.edu', realm_access: { roles: [Role.DamplabStaff] } } as any);
    await resolver.jobsForViewer({} as any, client);
    expect(findJobsForViewer.mock.calls[0][1]).toMatchObject({ includeSubmittedBy: true });
    expect(findJobsForViewer.mock.calls[1][1]).toMatchObject({ includeSubmittedBy: false });
  });
});

describe('JobResolver — members act as the owner (B2–B4)', () => {
  const member: any = { sub: 'member-sub', email: 'Member@X.org', preferred_username: 'Member', realm_access: { roles: [] } };
  const namedClient: any = { sub: 'client-sub', email: 'client@bu.edu', preferred_username: 'Client', realm_access: { roles: [] } };
  const strangerUser: any = { sub: 'stranger', email: 'stranger@x.org', preferred_username: 'S', realm_access: { roles: [] } };
  // A legacy, unmigrated staff submission (sub/email still the technician's): the
  // named client must still act through clientEmail (B4). New-style jobs are covered in Task 4.
  const baseJob = (over: any = {}): any => ({
    _id: 'job-1',
    name: 'Job',
    sub: 'staff-sub',
    email: 'tech@bu.edu',
    clientEmail: 'client@bu.edu',
    memberEmails: ['member@x.org'],
    workflows: [],
    ...over
  });

  function harness(job: any): { resolver: JobResolver; saveWorkflows: jest.Mock; updateState: jest.Mock; addAttachments: jest.Mock } {
    const saveWorkflows = jest.fn(async () => job);
    const updateState = jest.fn(async (_j: any, state: any) => ({ ...job, state }));
    const addAttachments = jest.fn(async () => job);
    const jobService: any = { findById: jest.fn(async () => job), updateState, addAttachments, claimSubIfPrimary: jest.fn(async (j: any) => j) };
    const jobVersionService: any = { saveWorkflows, appendStateEvent: jest.fn(async () => undefined) };
    const activityService: any = { createEvent: jest.fn(async () => undefined) };
    const sowService: any = { syncServicesFromJobWorkflows: jest.fn(async () => undefined) };
    const jobScreeningService: any = { screenJobInBackground: jest.fn() };
    const resolver = new JobResolver(
      jobService,
      {} as any,
      {} as any,
      activityService,
      {} as any,
      sowService,
      {} as any,
      jobVersionService,
      {} as any,
      {} as any,
      {} as any,
      jobScreeningService,
      {} as any
    );
    return { resolver, saveWorkflows, updateState, addAttachments };
  }

  it('ownJobById opens the job for a member and returns null to a stranger', async () => {
    const { resolver } = harness(baseJob());
    expect(await resolver.ownJobById('job-1', member)).toMatchObject({ _id: 'job-1' });
    expect(await resolver.ownJobById('job-1', strangerUser)).toBeNull();
  });

  it.each([
    ['member', member],
    ['client named on a staff-submitted job (B4)', namedClient]
  ])('lets the %s save the workflow while edit access is granted', async (_label, caller) => {
    const { resolver, saveWorkflows } = harness(baseJob({ state: JobState.CHANGES_REQUESTED, customerActionRequired: 'EDIT_WORKFLOW' }));
    await resolver.saveJobWorkflows({ jobId: 'job-1', workflows: [], note: 'edit' } as any, caller);
    expect(saveWorkflows).toHaveBeenCalledTimes(1);
  });

  it('refuses a stranger saving the workflow', async () => {
    const { resolver, saveWorkflows } = harness(baseJob({ state: JobState.CHANGES_REQUESTED, customerActionRequired: 'EDIT_WORKFLOW' }));
    await expect(resolver.saveJobWorkflows({ jobId: 'job-1', workflows: [], note: 'edit' } as any, strangerUser)).rejects.toBeInstanceOf(ForbiddenException);
    expect(saveWorkflows).not.toHaveBeenCalled();
  });

  it('lets a member resubmit', async () => {
    const job = baseJob({ state: JobState.CHANGES_REQUESTED });
    const { resolver, updateState } = harness(job);
    await resolver.changeJobState(job, JobState.SUBMITTED, member);
    expect(updateState).toHaveBeenCalled();
  });

  it('lets a member add attachments and refuses a stranger', async () => {
    const { resolver, addAttachments } = harness(baseJob());
    await resolver.addJobAttachments('job-1', [{ filename: 'a.pdf', key: 'k', contentType: 'application/pdf', size: 1 }] as any, member);
    expect(addAttachments).toHaveBeenCalled();
    await expect(resolver.addJobAttachments('job-1', [] as any, strangerUser)).rejects.toThrow(/permission/);
  });
});

describe('JobResolver member management and description (B7–B9, B17)', () => {
  const member: any = { sub: 'member-sub', email: 'member@x.org', preferred_username: 'Member', realm_access: { roles: [] } };
  const primary: any = { sub: 'client-sub', email: 'client@bu.edu', preferred_username: 'Client', realm_access: { roles: [] } };
  const adminUser: any = { sub: 'admin', email: 'admin@bu.edu', preferred_username: 'Admin', realm_access: { roles: [Role.DamplabStaff] } };
  const tech: any = { sub: 'tech', email: 'tech@bu.edu', preferred_username: 'Tech', realm_access: { roles: [Role.Technician] } };
  const strangerUser: any = { sub: 'x', email: 'x@x.org', preferred_username: 'X', realm_access: { roles: [] } };

  function harness(over: any = {}): { resolver: JobResolver; job: any; jobService: any; createEvent: jest.Mock } {
    const job: any = { _id: 'job-1', name: 'Job', sub: 'staff-sub', email: 'tech@bu.edu', clientEmail: 'client@bu.edu', memberEmails: ['member@x.org'], state: JobState.CLOSED, ...over };
    const jobService: any = {
      findById: jest.fn(async () => job),
      addMember: jest.fn(async (_id: string, email: string) => ({ ...job, memberEmails: [...job.memberEmails, email] })),
      removeMember: jest.fn(async (_id: string, email: string) => ({ ...job, memberEmails: job.memberEmails.filter((e: string) => e !== email) })),
      setDescription: jest.fn(async (_id: string, description?: string) => ({ ...job, description })),
      claimSubIfPrimary: jest.fn(async (j: any) => j)
    };
    const createEvent = jest.fn(async () => undefined);
    const resolver = new JobResolver(jobService, {} as any, {} as any, { createEvent } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { resolver, job, jobService, createEvent };
  }

  it('adds a normalized email in any state, even a closed job, and records who did it', async () => {
    const { resolver, jobService, createEvent } = harness();
    const updated = await resolver.addJobMember('job-1', '  New@Y.org ', member);
    expect(jobService.addMember).toHaveBeenCalledWith('job-1', 'new@y.org');
    expect(updated.memberEmails).toContain('new@y.org');
    expect(createEvent.mock.calls[0][0].message).toMatch(/new@y\.org/);
    expect(createEvent.mock.calls[0][0].actorDisplayName).toBe('Member');
  });

  it('is idempotent for an existing member or the primary', async () => {
    const { resolver, jobService, createEvent } = harness();
    await resolver.addJobMember('job-1', 'MEMBER@x.org', member);
    await resolver.addJobMember('job-1', 'client@bu.edu', member);
    expect(jobService.addMember).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('rejects a malformed email', async () => {
    const { resolver } = harness();
    await expect(resolver.addJobMember('job-1', 'not-an-email', member)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets damplab-staff manage members, and refuses a technician who is not a member, and a stranger', async () => {
    const { resolver } = harness();
    await expect(resolver.addJobMember('job-1', 'a@b.org', adminUser)).resolves.toBeDefined();
    await expect(resolver.addJobMember('job-1', 'a@b.org', tech)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(resolver.removeJobMember('job-1', 'member@x.org', strangerUser)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to remove the primary client', async () => {
    const { resolver } = harness();
    await expect(resolver.removeJobMember('job-1', 'Client@BU.edu', adminUser)).rejects.toThrow("The primary client can't be removed");
  });

  it('lets a member remove themselves, and treats a non-member removal as a no-op', async () => {
    const { resolver, jobService } = harness();
    const updated = await resolver.removeJobMember('job-1', 'member@x.org', member);
    expect(updated.memberEmails).toEqual([]);
    jobService.removeMember.mockClear();
    await resolver.removeJobMember('job-1', 'nobody@x.org', primary);
    expect(jobService.removeMember).not.toHaveBeenCalled();
  });

  it('404s on a missing job', async () => {
    const { resolver, jobService } = harness();
    jobService.findById.mockResolvedValueOnce(null);
    await expect(resolver.addJobMember('job-1', 'a@b.org', member)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sets the description for a member or a jobs:view-all holder, trimmed, in any state', async () => {
    const { resolver, jobService } = harness();
    await resolver.setJobDescription('job-1', member, '  For lab 4 ');
    expect(jobService.setDescription).toHaveBeenLastCalledWith('job-1', 'For lab 4');
    await resolver.setJobDescription('job-1', tech, '');
    expect(jobService.setDescription).toHaveBeenLastCalledWith('job-1', undefined);
  });

  it('refuses a stranger and an over-long description', async () => {
    const { resolver } = harness();
    await expect(resolver.setJobDescription('job-1', strangerUser, 'x')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(resolver.setJobDescription('job-1', member, 'x'.repeat(501))).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('JobResolver.reviewJob — owner notification (F4)', () => {
  it.each(['ACCEPT', 'REQUEST_CLARIFICATION', 'REQUEST_EDITS', 'REQUEST_APPROVAL'])('dispatches JOB_REVIEWED for %s, keyed on the operation id', async (decision) => {
    const dispatch = jest.fn();
    const reviewJob = jest.fn(async () => ({ _id: 'job-1', name: 'Job' }));
    const resolver = new JobResolver(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { reviewJob } as any,
      {} as any,
      { dispatch } as any,
      {} as any,
      {} as any
    );
    const staff: any = { sub: 'staff-1', email: 's@bu.edu', preferred_username: 'Staff', realm_access: { roles: [Role.DamplabStaff] } };
    await resolver.reviewJob({ operationId: 'op-1', jobId: 'job-1', decision } as any, staff);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'JOB_REVIEWED', jobId: 'job-1', actorSub: 'staff-1', operationId: 'job-reviewed:op-1' }));
    expect(dispatch.mock.calls[0][0].title).toBeTruthy();
  });

  it('does not notify when the review fails', async () => {
    const dispatch = jest.fn();
    const resolver = new JobResolver(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        reviewJob: jest.fn(async () => {
          throw new BadRequestException('no');
        })
      } as any,
      {} as any,
      { dispatch } as any,
      {} as any,
      {} as any
    );
    await expect(resolver.reviewJob({ operationId: 'op-2', jobId: 'job-1', decision: 'ACCEPT' } as any, { sub: 's', realm_access: { roles: [] } } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
