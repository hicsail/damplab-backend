import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { CustomerActionRequired, JobState } from './job.model';
import { JobReviewService } from './job-review.service';
import { JobReviewDecision } from './dto/review-job.input';
import { JobVersionAuthorRole } from '../job-version/job-version.model';
import { JobReviewCommandKind, JobReviewOperationStatus } from './job-review-operation.model';

const JOB_ID = '000000000000000000000001';
const VERSION_WORKFLOWS = [
  {
    name: 'Workflow',
    nodes: [
      {
        id: 'node-a',
        serviceId: 'svc-a',
        serviceName: 'Service A',
        formData: [{ id: 'volume', value: 10 }],
        additionalInstructions: ' keep cold ',
        price: 12.5,
        position: { x: 50, y: 80 }
      }
    ],
    edges: []
  }
];

const staff = { sub: 'staff-1', name: 'Staff Person' };
const customer = { sub: 'customer-1', name: 'Customer Person' };

interface Harness {
  service: JobReviewService;
  job: any;
  versions: any[];
  comments: any[];
  activityEvents: any[];
  operations: any[];
  restores: any[];
  sowSyncs: string[];
  sowCancels: Array<{ jobId: string; note?: string }>;
  failPublicationOnce: () => void;
  failCommentOnce: () => void;
  failEventOnce: () => void;
  failActivityOnce: () => void;
  raceJournalCreateOnce: () => void;
  addContentOnLatestRead: (readNumber: number, versionNumber: number) => void;
  onLatestRead: (readNumber: number, effect: () => void) => void;
  failLatestReadOnce: (readNumber: number) => void;
  preferCasStatus: (status: JobReviewOperationStatus) => void;
}

function buildHarness(overrides: Record<string, unknown> = {}, opts: { seedVersions?: any[]; sowStatus?: string | null } = {}): Harness {
  const job: any = {
    _id: JOB_ID,
    sub: customer.sub,
    state: JobState.SUBMITTED,
    customerCategory: 'INTERNAL_CUSTOMERS',
    ...overrides
  };
  const versions: any[] = opts.seedVersions ?? [
    {
      _id: 'content-1000',
      jobId: JOB_ID,
      versionNumber: 1000,
      authorRole: JobVersionAuthorRole.CUSTOMER,
      workflows: [{ name: 'old', nodes: [], edges: [] }],
      visibleToCustomer: true,
      isEvent: false
    },
    {
      _id: 'content-1001',
      jobId: JOB_ID,
      versionNumber: 1001,
      authorRole: JobVersionAuthorRole.STAFF,
      workflows: VERSION_WORKFLOWS,
      visibleToCustomer: false,
      isEvent: false
    },
    {
      _id: 'event-2000',
      jobId: JOB_ID,
      versionNumber: 2000,
      authorRole: JobVersionAuthorRole.STAFF,
      workflows: VERSION_WORKFLOWS,
      visibleToCustomer: true,
      isEvent: true
    }
  ];
  const comments: any[] = [];
  const activityEvents: any[] = [];
  const operations: any[] = [];
  const restores: any[] = [];
  let publicationFailures = 0;
  let commentFailures = 0;
  let eventFailures = 0;
  let activityFailures = 0;
  let journalCreateRaces = 0;
  let latestReads = 0;
  const contentOnRead = new Map<number, number>();
  const latestReadEffects = new Map<number, () => void>();
  const latestReadFailures = new Set<number>();
  let preferredCasStatus: JobReviewOperationStatus | undefined;

  const valuesEqual = (actual: unknown, expected: unknown): boolean => {
    if (expected === null) return actual == null;
    if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
    return actual === expected;
  };
  const matches = (filter: any): boolean => {
    if (String(filter._id) !== String(job._id)) return false;
    for (const [key, expected] of Object.entries(filter)) {
      if (key === '_id') continue;
      const actual = job[key];
      if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
        if ('$in' in expected && !(expected as any).$in.some((value: unknown) => valuesEqual(actual, value))) return false;
        if ('$ne' in expected && valuesEqual(actual, (expected as any).$ne)) return false;
        continue;
      }
      if (!valuesEqual(actual, expected)) return false;
    }
    return true;
  };
  const exec = <T>(value: T): { exec: () => Promise<T> } => ({ exec: async () => value });
  const jobModel: any = {
    findById: (id: string) => exec(String(id) === JOB_ID ? job : null),
    findOneAndUpdate: (filter: any, update: any) => {
      if (!matches(filter)) return exec(null);
      Object.assign(job, update.$set ?? {});
      for (const key of Object.keys(update.$unset ?? {})) delete job[key];
      return exec(job);
    }
  };

  const versionService: any = {
    // The lazy v1 backfill: a job submitted before versioning existed has no
    // rows until its history is read, and only this call creates them.
    listByJob: async () => {
      if (versions.length === 0) {
        versions.push({
          _id: 'content-backfilled',
          jobId: JOB_ID,
          versionNumber: 1000,
          authorRole: JobVersionAuthorRole.CUSTOMER,
          workflows: VERSION_WORKFLOWS,
          note: 'Original submission',
          visibleToCustomer: true,
          isEvent: false
        });
      }
      return [...versions].sort((a, b) => a.versionNumber - b.versionNumber);
    },
    getLatestContentVersion: async () => {
      latestReads += 1;
      latestReadEffects.get(latestReads)?.();
      if (latestReadFailures.delete(latestReads)) throw new Error('latest check failed');
      const versionNumber = contentOnRead.get(latestReads);
      if (versionNumber != null) {
        versions.push({
          _id: `content-${versionNumber}`,
          jobId: JOB_ID,
          versionNumber,
          authorRole: JobVersionAuthorRole.STAFF,
          workflows: [{ name: `concurrent-${versionNumber}`, nodes: [], edges: [] }],
          visibleToCustomer: false,
          isEvent: false
        });
      }
      return [...versions].filter((version) => version.isEvent !== true).sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null;
    },
    restoreVersion: async (_jobId: string, versionNumber: number, author: any, note: string, opts: any = {}) => {
      restores.push({ versionNumber, note, authorRole: author.role, visibleToCustomer: opts.visibleToCustomer });
      return {};
    },
    // The customer's own most recent content version, else the earliest one —
    // the same rule the real query applies.
    getCustomerBaselineVersion: async () => {
      const content = versions.filter((v) => v.isEvent !== true);
      const theirs = content.filter((v) => v.authorRole === JobVersionAuthorRole.CUSTOMER).sort((a, b) => b.versionNumber - a.versionNumber)[0];
      return theirs ?? [...content].sort((a, b) => a.versionNumber - b.versionNumber)[0] ?? null;
    },
    getContentVersion: async (_jobId: string, versionNumber: number) => versions.find((version) => version.isEvent !== true && version.versionNumber === versionNumber) ?? null,
    findByOperationId: async (_jobId: string, operationId: string) => versions.find((version) => version.isEvent === true && version.operationId === operationId) ?? null,
    publishVersion: async (_jobId: string, versionNumber: number, publishedBy: string) => {
      if (publicationFailures > 0) {
        publicationFailures -= 1;
        throw new Error('publication failed');
      }
      const version = versions.find((candidate) => candidate.versionNumber === versionNumber && candidate.isEvent !== true);
      if (!version) throw new Error('missing version');
      if (version.authorRole === JobVersionAuthorRole.STAFF && version.visibleToCustomer === false) {
        version.visibleToCustomer = true;
        version.publishedAt = new Date('2026-08-21T16:00:00.000Z');
        version.publishedBy = publishedBy;
      }
      return version;
    },
    appendStateEvent: async (updatedJob: any, newState: JobState, author: any, note: string, operationId: string, workflows?: any[]) => {
      if (eventFailures > 0) {
        eventFailures -= 1;
        throw new Error('event failed');
      }
      const existing = versions.find((version) => version.isEvent === true && version.operationId === operationId);
      if (existing) return existing;
      const event = {
        _id: `event-${operationId}`,
        jobId: JOB_ID,
        versionNumber: Math.max(...versions.map((version) => version.versionNumber)) + 1,
        authorRole: author.role,
        workflows: workflows ?? VERSION_WORKFLOWS,
        visibleToCustomer: true,
        isEvent: true,
        jobState: newState,
        note,
        operationId,
        createdBy: author.sub,
        createdByName: author.name,
        job: updatedJob
      };
      versions.push(event);
      return event;
    }
  };

  const commentService: any = {
    createIdempotent: async (input: any) => {
      if (commentFailures > 0) {
        commentFailures -= 1;
        throw new Error('comment failed');
      }
      const existing = comments.find((comment) => comment.jobId === input.jobId && comment.operationId === input.operationId);
      if (existing) return existing;
      const created = { _id: `comment-${input.operationId}`, ...input };
      comments.push(created);
      return created;
    }
  };
  const sowSyncs: string[] = [];
  const sowCancels: Array<{ jobId: string; note?: string }> = [];
  const sowService: any = {
    jobBillingFingerprint: async () => 'billing-current',
    syncServicesFromJobWorkflows: async (jobId: string) => {
      sowSyncs.push(jobId);
    },
    // `undefined` status means the job has no SOW at all, which is the common
    // case for the states these tests drive.
    findByJobId: async () => (opts.sowStatus == null ? null : { _id: 'sow-1', status: opts.sowStatus }),
    cancelForCancelledJob: async (jobId: string, note?: string) => {
      sowCancels.push({ jobId, note });
    }
  };
  const activityService: any = {
    createEventIdempotent: async (input: any) => {
      if (activityFailures > 0) {
        activityFailures -= 1;
        throw new Error('activity failed');
      }
      const existing = activityEvents.find((event) => event.operationId === input.operationId);
      if (existing) return existing;
      const created = { _id: `activity-${input.operationId}`, ...input };
      activityEvents.push(created);
      return created;
    }
  };
  const operationModel: any = {
    findOne: (query: any) => exec(operations.find((operation) => operation.operationId === query.operationId) ?? null),
    create: async (input: any) => {
      if (journalCreateRaces > 0) {
        journalCreateRaces -= 1;
        operations.push({ _id: `operation-${input.operationId}`, ...input });
        const error: any = new Error('duplicate operation');
        error.code = 11000;
        throw error;
      }
      const created = { _id: `operation-${input.operationId}`, ...input };
      operations.push(created);
      return created;
    },
    findOneAndUpdate: (filter: any, update: any) => {
      return {
        exec: async (): Promise<any> => {
          const nextStatus = update.$set?.status as JobReviewOperationStatus | undefined;
          if (
            preferredCasStatus &&
            filter.status === JobReviewOperationStatus.APPLIED &&
            nextStatus !== preferredCasStatus &&
            [JobReviewOperationStatus.FINALIZING, JobReviewOperationStatus.COMPENSATING].includes(nextStatus!)
          ) {
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          const operation = operations.find((candidate) => {
            if (candidate.operationId !== filter.operationId) return false;
            if (filter.status !== undefined && candidate.status !== filter.status) return false;
            return true;
          });
          if (operation) {
            Object.assign(operation, update.$set ?? {});
            for (const key of Object.keys(update.$unset ?? {})) delete operation[key];
          }
          return operation ?? null;
        }
      };
    }
  };

  return {
    service: new (JobReviewService as any)(jobModel, operationModel, versionService, commentService, sowService, activityService),
    job,
    versions,
    comments,
    activityEvents,
    operations,
    restores,
    sowSyncs,
    sowCancels,
    failPublicationOnce: (): void => {
      publicationFailures += 1;
    },
    failCommentOnce: (): void => {
      commentFailures += 1;
    },
    failEventOnce: (): void => {
      eventFailures += 1;
    },
    failActivityOnce: (): void => {
      activityFailures += 1;
    },
    raceJournalCreateOnce: (): void => {
      journalCreateRaces += 1;
    },
    addContentOnLatestRead: (readNumber: number, versionNumber: number): void => {
      contentOnRead.set(readNumber, versionNumber);
    },
    onLatestRead: (readNumber: number, effect: () => void): void => {
      latestReadEffects.set(readNumber, effect);
    },
    failLatestReadOnce: (readNumber: number): void => {
      latestReadFailures.add(readNumber);
    },
    preferCasStatus: (status: JobReviewOperationStatus): void => {
      preferredCasStatus = status;
    }
  };
}

describe('JobReviewService.reviewJob', () => {
  it('emits one retry-safe review decision activity with actor and job context', async () => {
    const { service, activityEvents } = buildHarness();
    const input = { operationId: 'review-activity', jobId: JOB_ID, decision: JobReviewDecision.REQUEST_EDITS, message: 'Please revise.' };

    await service.reviewJob(input, staff);
    await service.reviewJob(input, staff);

    expect(activityEvents).toEqual([
      expect.objectContaining({
        type: 'JOB_REVIEWED',
        operationId: 'JOB_REVIEWED:review-activity',
        jobId: JOB_ID,
        actorDisplayName: staff.name,
        message: expect.stringContaining('Workflow edits requested')
      })
    ]);
  });

  it('repairs review activity after the authoritative review completed', async () => {
    const { service, operations, activityEvents, failActivityOnce } = buildHarness();
    const input = { operationId: 'review-activity-repair', jobId: JOB_ID, decision: JobReviewDecision.REQUEST_APPROVAL, message: 'Please approve.' };
    failActivityOnce();

    await expect(service.reviewJob(input, staff)).rejects.toThrow('activity failed');
    expect(operations[0].status).not.toBe(JobReviewOperationStatus.COMPLETE);
    expect(activityEvents).toHaveLength(0);

    await service.reviewJob(input, staff);
    expect(operations[0]).toMatchObject({ status: JobReviewOperationStatus.COMPLETE, activityWrittenAt: expect.any(Date) });
    expect(activityEvents).toHaveLength(1);
  });

  it.each([
    [JobReviewDecision.REQUEST_CLARIFICATION, CustomerActionRequired.REPLY, false],
    [JobReviewDecision.REQUEST_EDITS, CustomerActionRequired.EDIT_WORKFLOW, true],
    [JobReviewDecision.REQUEST_APPROVAL, CustomerActionRequired.APPROVE_WORKFLOW, false]
  ])('maps %s to its exact customer action', async (decision, action) => {
    const { service, job, comments } = buildHarness();

    await service.reviewJob({ operationId: `op-${decision}`, jobId: JOB_ID, decision, message: 'Please address this.' }, staff);

    expect(job).toMatchObject({
      state: JobState.CHANGES_REQUESTED,
      customerActionRequired: action
    });
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      author: staff.name,
      authorType: 'STAFF',
      isInternal: false,
      operationId: `op-${decision}`
    });
    expect(comments[0].content).toContain('Please address this.');
  });

  // The link is only useful where the customer can actually save from the
  // editor, which is the design-edit decision alone.
  it.each([
    [JobReviewDecision.REQUEST_EDITS, true],
    [JobReviewDecision.REQUEST_CLARIFICATION, false],
    [JobReviewDecision.REQUEST_APPROVAL, false]
  ])('offers the workflow editor link for %s only when editing is granted', async (decision, expected) => {
    const { service, comments } = buildHarness();

    await service.reviewJob({ operationId: `link-${decision}`, jobId: JOB_ID, decision, message: 'Please address this.' }, staff);

    expect(comments[0].content.includes(`[Open the workflow editor](/job_editor/${JOB_ID})`)).toBe(expected);
  });

  const allowedSourceStates = [JobState.SUBMITTED, JobState.CHANGES_REQUESTED, JobState.ACCEPTED];
  const reviewDecisions = [JobReviewDecision.ACCEPT, JobReviewDecision.REQUEST_CLARIFICATION, JobReviewDecision.REQUEST_EDITS, JobReviewDecision.REQUEST_APPROVAL];

  it.each(allowedSourceStates.flatMap((state) => reviewDecisions.map((decision) => [decision, state] as const)))('allows %s from reviewable source state %s', async (decision, sourceState) => {
    const originalAction = sourceState === JobState.SUBMITTED ? null : sourceState === JobState.CHANGES_REQUESTED ? CustomerActionRequired.REPLY : CustomerActionRequired.APPROVE_WORKFLOW;
    const { service, job, operations } = buildHarness({
      state: sourceState,
      customerActionRequired: originalAction,
      acceptedJobVersionNumber: sourceState === JobState.ACCEPTED ? 1000 : undefined
    });

    await service.reviewJob(
      {
        operationId: `allowed-${decision}-${sourceState}`,
        jobId: JOB_ID,
        decision,
        message: decision === JobReviewDecision.ACCEPT ? undefined : 'Please address this.'
      },
      staff
    );

    expect(job.state).toBe(decision === JobReviewDecision.ACCEPT ? JobState.ACCEPTED : JobState.CHANGES_REQUESTED);
    expect(operations[0]).toMatchObject({
      originalState: sourceState,
      originalCustomerActionRequired: originalAction,
      status: JobReviewOperationStatus.COMPLETE
    });
  });

  const disallowedSourceStates = [JobState.CREATING, JobState.WAITING_FOR_SOW, JobState.QUEUED, JobState.IN_PROGRESS, JobState.COMPLETE, JobState.REJECTED, JobState.CLOSED];

  it.each(disallowedSourceStates.flatMap((state) => reviewDecisions.map((decision) => [decision, state] as const)))('rejects %s from non-reviewable source state %s', async (decision, sourceState) => {
    const { service, job, operations } = buildHarness({ state: sourceState });

    await expect(
      service.reviewJob(
        {
          operationId: `disallowed-${decision}-${sourceState}`,
          jobId: JOB_ID,
          decision,
          message: decision === JobReviewDecision.ACCEPT ? undefined : 'Please address this.'
        },
        staff
      )
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(job.state).toBe(sourceState);
    expect(operations[0].status).toBe(JobReviewOperationStatus.CONFLICTED);
  });

  it.each([JobReviewDecision.REQUEST_CLARIFICATION, JobReviewDecision.REQUEST_EDITS, JobReviewDecision.REQUEST_APPROVAL])('rejects a blank message for %s before changing state', async (decision) => {
    const { service, job, comments } = buildHarness();

    await expect(service.reviewJob({ operationId: `blank-${decision}`, jobId: JOB_ID, decision, message: '   ' }, staff)).rejects.toBeInstanceOf(BadRequestException);

    expect(job.state).toBe(JobState.SUBMITTED);
    expect(comments).toHaveLength(0);
  });

  it('accepts the exact latest non-event version and publishes that same snapshot', async () => {
    const { service, job, versions } = buildHarness();

    await service.reviewJob({ operationId: 'accept-1', jobId: JOB_ID, decision: JobReviewDecision.ACCEPT }, staff);

    expect(job).toMatchObject({
      state: JobState.ACCEPTED,
      acceptedJobVersionNumber: 1001,
      acceptedBillingFingerprint: 'billing-current',
      acceptedBy: staff.sub
    });
    expect(job.customerActionRequired).toBeNull();
    expect(job.acceptedAt).toBeInstanceOf(Date);

    const accepted = versions.find((version) => version.versionNumber === 1001);
    expect(accepted).toMatchObject({ visibleToCustomer: true, publishedBy: staff.sub });
    expect(accepted.workflows).toEqual(VERSION_WORKFLOWS);
    expect(versions.find((version) => version.versionNumber === 2000)?.isEvent).toBe(true);
  });

  // Jobs submitted before versioning existed carry no version rows until someone
  // reads their history. Without forcing that backfill, accepting one fails and
  // staff have no way to clear it — which is exactly the remedy the contract-flow
  // migration hands them for jobs it cannot stamp.
  it('synthesizes the original submission when accepting a job that has no versions yet', async () => {
    const { service, job, versions } = buildHarness({}, { seedVersions: [] });

    await service.reviewJob({ operationId: 'accept-legacy', jobId: JOB_ID, decision: JobReviewDecision.ACCEPT }, staff);

    expect(job).toMatchObject({ state: JobState.ACCEPTED, acceptedJobVersionNumber: 1000 });

    const backfilled = versions.find((version) => version.versionNumber === 1000);
    expect(backfilled).toMatchObject({ note: 'Original submission', authorRole: JobVersionAuthorRole.CUSTOMER, isEvent: false });
  });

  it('repairs publication on retry without duplicating comments or acceptance history', async () => {
    const { service, job, versions, comments, failPublicationOnce } = buildHarness();
    const input = { operationId: 'accept-retry', jobId: JOB_ID, decision: JobReviewDecision.ACCEPT };
    failPublicationOnce();

    await expect(service.reviewJob(input, staff)).rejects.toThrow('publication failed');
    expect(job.acceptedJobVersionNumber).toBe(1001);
    expect(versions.find((version) => version.operationId === input.operationId)).toBeDefined();

    await service.reviewJob(input, staff);
    await service.reviewJob(input, staff);

    expect(versions.find((version) => version.versionNumber === 1001)?.visibleToCustomer).toBe(true);
    expect(versions.filter((version) => version.operationId === input.operationId)).toHaveLength(1);
    expect(comments.filter((comment) => comment.operationId === input.operationId)).toHaveLength(1);
  });

  it('records a visible acceptance event even when re-accepting an already accepted job', async () => {
    const { service, versions } = buildHarness({ state: JobState.ACCEPTED, acceptedJobVersionNumber: 1000 });

    await service.reviewJob({ operationId: 'reaccept-1', jobId: JOB_ID, decision: JobReviewDecision.ACCEPT, message: 'Rechecked after revision.' }, staff);

    expect(versions.find((version) => version.operationId === 'reaccept-1')).toMatchObject({
      isEvent: true,
      visibleToCustomer: true,
      jobState: JobState.ACCEPTED,
      note: 'Accepted'
    });
  });

  it('does not overwrite a concurrent state transition when its conditional update loses', async () => {
    const { service, job } = buildHarness();
    const model = (service as any).jobModel;
    let authoritativeFilter: any;
    model.findOneAndUpdate = (filter: any): { exec: () => Promise<null> } => {
      authoritativeFilter = filter;
      return { exec: async (): Promise<null> => null };
    };

    await expect(service.reviewJob({ operationId: 'lost-race', jobId: JOB_ID, decision: JobReviewDecision.REQUEST_EDITS, message: 'Change this.' }, staff)).rejects.toBeInstanceOf(ConflictException);

    expect(authoritativeFilter.state).toBe(JobState.SUBMITTED);
    expect(job.state).toBe(JobState.SUBMITTED);
  });
});

describe('JobReviewService.respondToJobReview', () => {
  it('emits one retry-safe response activity with the original customer action', async () => {
    const { service, activityEvents } = buildHarness({
      state: JobState.CHANGES_REQUESTED,
      customerActionRequired: CustomerActionRequired.EDIT_WORKFLOW
    });
    const input = { operationId: 'response-activity', jobId: JOB_ID, message: 'Revised.' };

    await service.respondToJobReview(input, customer);
    await service.respondToJobReview(input, customer);

    expect(activityEvents).toEqual([
      expect.objectContaining({
        type: 'JOB_REVIEW_RESPONSE',
        operationId: 'JOB_REVIEW_RESPONSE:response-activity',
        jobId: JOB_ID,
        actorDisplayName: customer.name,
        message: expect.stringContaining(CustomerActionRequired.EDIT_WORKFLOW)
      })
    ]);
  });

  it('lets the owner reply, clears the action/editing grant, and resubmits atomically', async () => {
    const { service, job, comments } = buildHarness({
      state: JobState.CHANGES_REQUESTED,
      customerActionRequired: CustomerActionRequired.REPLY
    });

    await service.respondToJobReview({ operationId: 'reply-1', jobId: JOB_ID, message: 'Here is the answer.' }, customer);

    expect(job).toMatchObject({
      state: JobState.SUBMITTED,
      customerActionRequired: null
    });
    expect(comments[0]).toMatchObject({
      author: customer.name,
      authorType: 'CLIENT',
      isInternal: false,
      operationId: 'reply-1'
    });
    expect(comments[0].content).toContain('Here is the answer.');
  });

  it('requires a nonblank message for REPLY', async () => {
    const { service, job } = buildHarness({
      state: JobState.CHANGES_REQUESTED,
      customerActionRequired: CustomerActionRequired.REPLY
    });

    await expect(service.respondToJobReview({ operationId: 'blank-reply', jobId: JOB_ID, message: ' ' }, customer)).rejects.toBeInstanceOf(BadRequestException);
    expect(job.state).toBe(JobState.CHANGES_REQUESTED);
  });

  it.each([CustomerActionRequired.EDIT_WORKFLOW, CustomerActionRequired.APPROVE_WORKFLOW])('allows an optional response note for %s', async (action) => {
    const { service, job, comments } = buildHarness({
      state: JobState.CHANGES_REQUESTED,
      customerActionRequired: action
    });

    await service.respondToJobReview({ operationId: `respond-${action}`, jobId: JOB_ID }, customer);

    expect(job.state).toBe(JobState.SUBMITTED);
    expect(comments).toHaveLength(1);
  });

  it('rejects a user who does not own the job', async () => {
    const { service, job } = buildHarness({
      state: JobState.CHANGES_REQUESTED,
      customerActionRequired: CustomerActionRequired.REPLY
    });

    await expect(service.respondToJobReview({ operationId: 'not-owner', jobId: JOB_ID, message: 'No.' }, { sub: 'other', name: 'Other' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(job.state).toBe(JobState.CHANGES_REQUESTED);
  });

  it.each([
    { state: JobState.SUBMITTED, customerActionRequired: CustomerActionRequired.REPLY },
    { state: JobState.CHANGES_REQUESTED, customerActionRequired: null }
  ])('requires CHANGES_REQUESTED with a non-null customer action', async (overrides) => {
    const { service } = buildHarness(overrides);

    await expect(service.respondToJobReview({ operationId: `invalid-${overrides.state}`, jobId: JOB_ID, message: 'Answer.' }, customer)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is retry-idempotent for the response comment and history event', async () => {
    const { service, versions, comments } = buildHarness({
      state: JobState.CHANGES_REQUESTED,
      customerActionRequired: CustomerActionRequired.EDIT_WORKFLOW
    });
    const input = { operationId: 'response-retry', jobId: JOB_ID, message: 'Done.' };

    await service.respondToJobReview(input, customer);
    await service.respondToJobReview(input, customer);

    expect(versions.filter((version) => version.operationId === input.operationId)).toHaveLength(1);
    expect(comments.filter((comment) => comment.operationId === input.operationId)).toHaveLength(1);
  });

  it('repairs a failed response comment with the original server-generated action header', async () => {
    const { service, comments, failCommentOnce } = buildHarness({
      state: JobState.CHANGES_REQUESTED,
      customerActionRequired: CustomerActionRequired.EDIT_WORKFLOW
    });
    const input = { operationId: 'response-comment-retry', jobId: JOB_ID };
    failCommentOnce();

    await expect(service.respondToJobReview(input, customer)).rejects.toThrow('comment failed');
    await service.respondToJobReview(input, customer);

    expect(comments).toHaveLength(1);
    expect(comments[0].content).toBe('Customer response: EDIT_WORKFLOW');
  });

  it('repairs a failed response history event after the authoritative state update', async () => {
    const { service, job, versions, comments, failEventOnce } = buildHarness({
      state: JobState.CHANGES_REQUESTED,
      customerActionRequired: CustomerActionRequired.APPROVE_WORKFLOW
    });
    const input = { operationId: 'response-event-retry', jobId: JOB_ID };
    failEventOnce();

    await expect(service.respondToJobReview(input, customer)).rejects.toThrow('event failed');
    expect(job.state).toBe(JobState.SUBMITTED);

    await service.respondToJobReview(input, customer);

    expect(versions.filter((version) => version.operationId === input.operationId)).toHaveLength(1);
    expect(comments.filter((comment) => comment.operationId === input.operationId)).toHaveLength(1);
  });
});

describe('JobReviewService operation journal', () => {
  it('recovers a duplicate-key journal creation race and executes the operation once', async () => {
    const { service, operations, comments, raceJournalCreateOnce } = buildHarness();
    raceJournalCreateOnce();

    await service.reviewJob(
      {
        operationId: 'journal-race',
        jobId: JOB_ID,
        decision: JobReviewDecision.REQUEST_CLARIFICATION,
        message: 'Please explain.'
      },
      staff
    );

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      operationId: 'journal-race',
      commandKind: JobReviewCommandKind.REVIEW,
      status: JobReviewOperationStatus.COMPLETE
    });
    expect(comments.filter((comment) => comment.operationId === 'journal-race')).toHaveLength(1);
  });

  it('normalizes message whitespace when validating an exact retry', async () => {
    const { service, operations, comments } = buildHarness();

    await service.reviewJob(
      {
        operationId: 'normalized-retry',
        jobId: JOB_ID,
        decision: JobReviewDecision.REQUEST_EDITS,
        message: '  Please revise.  '
      },
      staff
    );
    await service.reviewJob(
      {
        operationId: 'normalized-retry',
        jobId: JOB_ID,
        decision: JobReviewDecision.REQUEST_EDITS,
        message: 'Please revise.'
      },
      staff
    );

    expect(operations).toHaveLength(1);
    expect(comments).toHaveLength(1);
  });

  it.each([
    {
      name: 'decision',
      retry: { operationId: 'collision', jobId: JOB_ID, decision: JobReviewDecision.REQUEST_APPROVAL, message: 'Please revise.' },
      actor: staff
    },
    {
      name: 'message',
      retry: { operationId: 'collision', jobId: JOB_ID, decision: JobReviewDecision.REQUEST_EDITS, message: 'Different text.' },
      actor: staff
    },
    {
      name: 'job',
      retry: { operationId: 'collision', jobId: '000000000000000000000099', decision: JobReviewDecision.REQUEST_EDITS, message: 'Please revise.' },
      actor: staff
    },
    {
      name: 'actor',
      retry: { operationId: 'collision', jobId: JOB_ID, decision: JobReviewDecision.REQUEST_EDITS, message: 'Please revise.' },
      actor: { sub: 'staff-2', name: 'Other Staff' }
    }
  ])('rejects an operationId reused with a different $name', async ({ retry, actor }) => {
    const { service } = buildHarness();
    await service.reviewJob(
      {
        operationId: 'collision',
        jobId: JOB_ID,
        decision: JobReviewDecision.REQUEST_EDITS,
        message: 'Please revise.'
      },
      staff
    );

    await expect(service.reviewJob(retry as any, actor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an operationId reused for a different command kind', async () => {
    const { service } = buildHarness();
    await service.reviewJob(
      {
        operationId: 'kind-collision',
        jobId: JOB_ID,
        decision: JobReviewDecision.REQUEST_CLARIFICATION,
        message: 'Please explain.'
      },
      staff
    );

    await expect(service.respondToJobReview({ operationId: 'kind-collision', jobId: JOB_ID, message: 'Answer.' }, staff)).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not treat a distinct operation with the same decision as a retry', async () => {
    const { service, operations, comments } = buildHarness();
    const command = {
      jobId: JOB_ID,
      decision: JobReviewDecision.REQUEST_EDITS,
      message: 'Please revise.'
    };

    await service.reviewJob({ operationId: 'first-edit-request', ...command }, staff);
    await service.reviewJob({ operationId: 'second-edit-request', ...command }, staff);

    expect(operations.map((operation) => operation.operationId)).toEqual(['first-edit-request', 'second-edit-request']);
    expect(operations.map((operation) => operation.status)).toEqual([JobReviewOperationStatus.COMPLETE, JobReviewOperationStatus.COMPLETE]);
    expect(comments).toHaveLength(2);
  });

  it('resumes an old response side effect without clearing an intervening newer action', async () => {
    const { service, job, versions, comments, failEventOnce } = buildHarness({
      state: JobState.CHANGES_REQUESTED,
      customerActionRequired: CustomerActionRequired.EDIT_WORKFLOW
    });
    failEventOnce();

    await expect(service.respondToJobReview({ operationId: 'old-response', jobId: JOB_ID, message: 'Edits complete.' }, customer)).rejects.toThrow('event failed');
    await service.reviewJob(
      {
        operationId: 'new-review',
        jobId: JOB_ID,
        decision: JobReviewDecision.REQUEST_APPROVAL,
        message: 'Please approve the revision.'
      },
      staff
    );

    await service.respondToJobReview({ operationId: 'old-response', jobId: JOB_ID, message: 'Edits complete.' }, customer);

    expect(job).toMatchObject({
      state: JobState.CHANGES_REQUESTED,
      customerActionRequired: CustomerActionRequired.APPROVE_WORKFLOW,
      lastReviewOperationId: 'new-review'
    });
    expect(versions.filter((version) => version.operationId === 'old-response')).toHaveLength(1);
    expect(comments.filter((comment) => comment.operationId === 'old-response')).toHaveLength(1);
  });

  it('rejects reuse of a completed response operationId for a different current action', async () => {
    const { service } = buildHarness({
      state: JobState.CHANGES_REQUESTED,
      customerActionRequired: CustomerActionRequired.EDIT_WORKFLOW
    });
    const response = { operationId: 'response-action-collision', jobId: JOB_ID, message: 'Done.' };

    await service.respondToJobReview(response, customer);
    await service.reviewJob(
      {
        operationId: 'next-review-action',
        jobId: JOB_ID,
        decision: JobReviewDecision.REQUEST_APPROVAL,
        message: 'Please approve.'
      },
      staff
    );

    await expect(service.respondToJobReview(response, customer)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('JobReviewService acceptance version races', () => {
  it('rejects a selected version that is no longer latest immediately before the Job write', async () => {
    const { service, job, operations, addContentOnLatestRead } = buildHarness();
    addContentOnLatestRead(2, 1002);

    await expect(service.reviewJob({ operationId: 'prewrite-race', jobId: JOB_ID, decision: JobReviewDecision.ACCEPT }, staff)).rejects.toBeInstanceOf(ConflictException);

    expect(job.state).toBe(JobState.SUBMITTED);
    expect(job.acceptedJobVersionNumber).toBeUndefined();
    expect(operations[0].status).toBe(JobReviewOperationStatus.CONFLICTED);
  });

  it('compensates acceptance when content moves before the final latest check', async () => {
    const { service, job, versions, comments, operations, addContentOnLatestRead } = buildHarness({
      state: JobState.SUBMITTED,
      customerActionRequired: null,
      acceptedJobVersionNumber: 1000,
      acceptedBillingFingerprint: 'old-billing',
      acceptedBy: 'old-staff',
      acceptedAt: new Date('2026-08-01T00:00:00.000Z')
    });
    addContentOnLatestRead(3, 1002);

    await expect(service.reviewJob({ operationId: 'final-race', jobId: JOB_ID, decision: JobReviewDecision.ACCEPT }, staff)).rejects.toBeInstanceOf(ConflictException);

    expect(job).toMatchObject({
      state: JobState.SUBMITTED,
      customerActionRequired: null,
      acceptedJobVersionNumber: 1000,
      acceptedBillingFingerprint: 'old-billing',
      acceptedBy: 'old-staff',
      acceptedAt: new Date('2026-08-01T00:00:00.000Z')
    });
    expect(job.lastReviewOperationId).toBeUndefined();
    expect(operations[0].status).toBe(JobReviewOperationStatus.COMPENSATED);
    expect(versions.find((version) => version.versionNumber === 1001)?.visibleToCustomer).toBe(false);
    expect(versions.some((version) => version.isEvent === true && version.operationId === 'final-race')).toBe(false);
    expect(comments.some((comment) => comment.operationId === 'final-race')).toBe(false);
  });

  it('finishes the originally selected version after FINALIZING even if newer content appears', async () => {
    const { service, job, versions, operations, failPublicationOnce } = buildHarness();
    const input = { operationId: 'original-version-retry', jobId: JOB_ID, decision: JobReviewDecision.ACCEPT };
    failPublicationOnce();

    await expect(service.reviewJob(input, staff)).rejects.toThrow('publication failed');
    versions.push({
      _id: 'content-1002',
      jobId: JOB_ID,
      versionNumber: 1002,
      authorRole: JobVersionAuthorRole.STAFF,
      workflows: [{ name: 'newer', nodes: [], edges: [] }],
      visibleToCustomer: false,
      isEvent: false
    });

    await expect(service.reviewJob(input, staff)).resolves.toMatchObject({
      state: JobState.ACCEPTED,
      acceptedJobVersionNumber: 1001
    });

    expect(operations[0].selectedAcceptedVersionNumber).toBe(1001);
    expect(operations[0].status).toBe(JobReviewOperationStatus.COMPLETE);
    expect(versions.find((version) => version.versionNumber === 1001)?.visibleToCustomer).toBe(true);
    expect(versions.find((version) => version.versionNumber === 1002)?.visibleToCustomer).toBe(false);
    expect(job.state).toBe(JobState.ACCEPTED);
  });

  it('retries a compensated stale acceptance as the same conflict without side effects', async () => {
    const { service, versions, comments, operations, addContentOnLatestRead } = buildHarness();
    const input = { operationId: 'compensated-retry', jobId: JOB_ID, decision: JobReviewDecision.ACCEPT };
    addContentOnLatestRead(3, 1002);

    const first = await service.reviewJob(input, staff).catch((error) => error);
    const retry = await service.reviewJob(input, staff).catch((error) => error);

    expect(first).toBeInstanceOf(ConflictException);
    expect(retry).toBeInstanceOf(ConflictException);
    expect(retry.message).toBe(first.message);
    expect(operations[0].status).toBe(JobReviewOperationStatus.COMPENSATED);
    expect(versions.find((version) => version.versionNumber === 1001)?.visibleToCustomer).toBe(false);
    expect(versions.some((version) => version.isEvent === true && version.operationId === input.operationId)).toBe(false);
    expect(comments.some((comment) => comment.operationId === input.operationId)).toBe(false);
  });

  it('allows compensation to win two concurrent retries racing the final latest check', async () => {
    const { service, job, versions, comments, operations, failLatestReadOnce, addContentOnLatestRead, preferCasStatus } = buildHarness();
    const input = { operationId: 'concurrent-compensation', jobId: JOB_ID, decision: JobReviewDecision.ACCEPT };
    failLatestReadOnce(3);

    await expect(service.reviewJob(input, staff)).rejects.toThrow('latest check failed');
    expect(operations[0].status).toBe(JobReviewOperationStatus.APPLIED);
    addContentOnLatestRead(5, 1002);
    preferCasStatus(JobReviewOperationStatus.COMPENSATING);

    const results = await Promise.allSettled([service.reviewJob(input, staff), service.reviewJob(input, staff)]);

    expect(results.every((result) => result.status === 'rejected' && result.reason instanceof ConflictException)).toBe(true);
    expect(operations[0].status).toBe(JobReviewOperationStatus.COMPENSATED);
    expect(job.state).toBe(JobState.SUBMITTED);
    expect(versions.find((version) => version.versionNumber === 1001)?.visibleToCustomer).toBe(false);
    expect(versions.some((version) => version.isEvent === true && version.operationId === input.operationId)).toBe(false);
    expect(comments.some((comment) => comment.operationId === input.operationId)).toBe(false);
  });

  it('allows finalization to win two concurrent retries racing compensation', async () => {
    const { service, job, versions, comments, operations, failLatestReadOnce, addContentOnLatestRead, preferCasStatus } = buildHarness();
    const input = { operationId: 'concurrent-finalization', jobId: JOB_ID, decision: JobReviewDecision.ACCEPT };
    failLatestReadOnce(3);

    await expect(service.reviewJob(input, staff)).rejects.toThrow('latest check failed');
    expect(operations[0].status).toBe(JobReviewOperationStatus.APPLIED);
    addContentOnLatestRead(5, 1002);
    preferCasStatus(JobReviewOperationStatus.FINALIZING);

    const results = await Promise.allSettled([service.reviewJob(input, staff), service.reviewJob(input, staff)]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(operations[0].status).toBe(JobReviewOperationStatus.COMPLETE);
    expect(job).toMatchObject({ state: JobState.ACCEPTED, acceptedJobVersionNumber: 1001 });
    expect(versions.find((version) => version.versionNumber === 1001)?.visibleToCustomer).toBe(true);
    expect(versions.filter((version) => version.isEvent === true && version.operationId === input.operationId)).toHaveLength(1);
    expect(comments.filter((comment) => comment.operationId === input.operationId)).toHaveLength(1);
  });

  it('does not compensate over an intervening command that owns the Job marker', async () => {
    const { service, job, operations, addContentOnLatestRead, onLatestRead } = buildHarness();
    addContentOnLatestRead(3, 1002);
    onLatestRead(3, () => {
      Object.assign(job, {
        state: JobState.CHANGES_REQUESTED,
        customerActionRequired: CustomerActionRequired.APPROVE_WORKFLOW,
        lastReviewOperationId: 'newer-command'
      });
    });

    await expect(service.reviewJob({ operationId: 'stale-owner', jobId: JOB_ID, decision: JobReviewDecision.ACCEPT }, staff)).rejects.toBeInstanceOf(ConflictException);

    expect(job).toMatchObject({
      state: JobState.CHANGES_REQUESTED,
      customerActionRequired: CustomerActionRequired.APPROVE_WORKFLOW,
      lastReviewOperationId: 'newer-command'
    });
    expect(operations[0].status).toBe(JobReviewOperationStatus.COMPENSATED);
  });
});

describe('JobReviewService withdrawal', () => {
  const withCustomer = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    state: JobState.CHANGES_REQUESTED,
    customerActionRequired: CustomerActionRequired.EDIT_WORKFLOW,
    handoverVersionNumber: 1000,
    ...over
  });

  it('takes the job back, restores the handover version, and publishes it to the customer', async () => {
    const { service, job, restores, comments, sowSyncs } = buildHarness(withCustomer());

    await service.withdrawJobFromCustomer({ operationId: 'wd-1', jobId: JOB_ID, reason: 'We need to rework the design.' }, staff);

    expect(job).toMatchObject({ state: JobState.SUBMITTED, lastReviewOperationId: 'wd-1' });
    expect(job.customerActionRequired).toBeNull();
    // Spent once used, so a later withdrawal cannot restore a stale baseline.
    expect(job.handoverVersionNumber).toBeNull();
    // Authored by the lab, because the lab is who reverted it — a rejection
    // restores the same way but under the customer's name.
    expect(restores).toEqual([{ versionNumber: 1000, note: 'Withdrawn by the lab', authorRole: JobVersionAuthorRole.STAFF, visibleToCustomer: true }]);
    expect(comments[0].content).toContain('We need to rework the design.');
    // The live graph moved; the SOW billing core has to follow or Recalculate
    // still shows the customer's unsubmitted draft.
    expect(sowSyncs).toEqual([JOB_ID]);
  });

  it('is retry-safe: a repeat under the same operationId restores and comments once', async () => {
    const { service, restores, comments, versions, sowSyncs } = buildHarness(withCustomer());
    const input = { operationId: 'wd-retry', jobId: JOB_ID, reason: 'Reworking.' };

    await service.withdrawJobFromCustomer(input, staff);
    await service.withdrawJobFromCustomer(input, staff);

    expect(restores).toHaveLength(1);
    expect(comments.filter((comment) => comment.operationId === input.operationId)).toHaveLength(1);
    expect(versions.filter((version) => version.operationId === input.operationId)).toHaveLength(1);
    expect(sowSyncs).toEqual([JOB_ID]);
  });

  it('still syncs the SOW if restore already landed and finalization is retried', async () => {
    const { service, restores, sowSyncs, failCommentOnce } = buildHarness(withCustomer());
    const input = { operationId: 'wd-sync-retry', jobId: JOB_ID, reason: 'Reworking.' };
    failCommentOnce();

    await expect(service.withdrawJobFromCustomer(input, staff)).rejects.toThrow('comment failed');
    expect(restores).toHaveLength(1);
    expect(sowSyncs).toEqual([JOB_ID]);

    await service.withdrawJobFromCustomer(input, staff);

    expect(restores).toHaveLength(1);
    expect(sowSyncs).toEqual([JOB_ID, JOB_ID]);
  });

  it('refuses to withdraw a job that is not with the customer', async () => {
    const { service } = buildHarness({ state: JobState.SUBMITTED });
    await expect(service.withdrawJobFromCustomer({ operationId: 'wd-2', jobId: JOB_ID, reason: 'why' }, staff)).rejects.toThrow(/not currently with the customer/);
  });

  it('requires a reason, since a withdrawal undoes work someone else did', async () => {
    const { service } = buildHarness(withCustomer());
    await expect(service.withdrawJobFromCustomer({ operationId: 'wd-3', jobId: JOB_ID, reason: '   ' }, staff)).rejects.toThrow(/reason/i);
  });

  // A legacy job handed over before the baseline was recorded: take it back
  // rather than refuse, and leave the graph where it is.
  it('still withdraws when no handover baseline was recorded, without restoring', async () => {
    const { service, job, restores, sowSyncs } = buildHarness(withCustomer({ handoverVersionNumber: undefined }));

    await service.withdrawJobFromCustomer({ operationId: 'wd-4', jobId: JOB_ID, reason: 'Legacy job.' }, staff);

    expect(job.state).toBe(JobState.SUBMITTED);
    expect(restores).toEqual([]);
    expect(sowSyncs).toEqual([]);
  });

  it('clears the whole acceptance stamp and leaves the graph alone', async () => {
    const { service, job, restores, comments, sowSyncs } = buildHarness({
      state: JobState.ACCEPTED,
      acceptedJobVersionNumber: 1001,
      acceptedBillingFingerprint: 'billing',
      acceptedAt: new Date('2026-03-01'),
      acceptedBy: 'staff-1'
    });

    await service.withdrawJobAcceptance({ operationId: 'wa-1', jobId: JOB_ID, reason: 'Price correction needed.' }, staff);

    expect(job.state).toBe(JobState.SUBMITTED);
    for (const field of ['acceptedJobVersionNumber', 'acceptedBillingFingerprint', 'acceptedAt', 'acceptedBy']) {
      expect(job[field]).toBeNull();
    }
    // Reopening the spec must not silently rewrite the graph.
    expect(restores).toEqual([]);
    expect(sowSyncs).toEqual([]);
    expect(comments[0].content).toContain('Price correction needed.');
  });

  it('refuses to withdraw acceptance from a job that was never accepted', async () => {
    const { service } = buildHarness({ state: JobState.SUBMITTED });
    await expect(service.withdrawJobAcceptance({ operationId: 'wa-2', jobId: JOB_ID, reason: 'why' }, staff)).rejects.toThrow(/has not been accepted/);
  });

  it('rejects an operationId reused across the two withdrawal kinds', async () => {
    const { service } = buildHarness(withCustomer());
    await service.withdrawJobFromCustomer({ operationId: 'shared', jobId: JOB_ID, reason: 'Reworking.' }, staff);

    await expect(service.withdrawJobAcceptance({ operationId: 'shared', jobId: JOB_ID, reason: 'Reworking.' }, staff)).rejects.toThrow(ConflictException);
  });
});

describe('JobReviewService handover baseline', () => {
  it('stamps the version in force when the job is handed over', async () => {
    const { service, job } = buildHarness();

    await service.reviewJob({ operationId: 'rc-1', jobId: JOB_ID, decision: JobReviewDecision.REQUEST_EDITS, message: 'Please revise.' }, staff);

    expect(job.handoverVersionNumber).toBe(1001);
  });

  // Each handover is a fresh baseline: withdrawing returns to the start of the
  // current round, not the beginning of the whole negotiation.
  it('re-stamps on a second request-changes', async () => {
    const { service, job, versions } = buildHarness();
    await service.reviewJob({ operationId: 'rc-a', jobId: JOB_ID, decision: JobReviewDecision.REQUEST_EDITS, message: 'Round one.' }, staff);

    versions.push({ _id: 'content-1500', jobId: JOB_ID, versionNumber: 1500, authorRole: JobVersionAuthorRole.CUSTOMER, workflows: VERSION_WORKFLOWS, visibleToCustomer: true, isEvent: false });
    await service.reviewJob({ operationId: 'rc-b', jobId: JOB_ID, decision: JobReviewDecision.REQUEST_EDITS, message: 'Round two.' }, staff);

    expect(job.handoverVersionNumber).toBe(1500);
  });

  it('does not stamp one on acceptance', async () => {
    const { service, job } = buildHarness();
    await service.reviewJob({ operationId: 'acc-1', jobId: JOB_ID, decision: JobReviewDecision.ACCEPT }, staff);
    expect(job.handoverVersionNumber ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Customer-initiated commands
// ---------------------------------------------------------------------------

const awaitingApproval = { state: JobState.CHANGES_REQUESTED, customerActionRequired: CustomerActionRequired.APPROVE_WORKFLOW };

describe('rejectJobReview', () => {
  const reject = { operationId: 'reject-1', jobId: JOB_ID, reason: 'The volumes are wrong.' };

  it('hands the job back to the lab rather than ending it', async () => {
    const { service, job } = buildHarness(awaitingApproval);
    await service.rejectJobReview(reject, customer);
    expect({ state: job.state, action: job.customerActionRequired ?? null }).toEqual({ state: JobState.SUBMITTED, action: null });
  });

  it('posts the reason once, as the customer, however many times the submit is retried', async () => {
    const { service, comments } = buildHarness(awaitingApproval);
    await service.rejectJobReview(reject, customer);
    await service.rejectJobReview(reject, customer);
    expect(comments).toEqual([
      expect.objectContaining({
        authorType: 'CLIENT',
        isInternal: false,
        content: 'Customer rejected the proposed workflow\n\nThe volumes are wrong.'
      })
    ]);
  });

  it('records the history event against the customer, not the lab', async () => {
    const { service, versions } = buildHarness(awaitingApproval);
    await service.rejectJobReview(reject, customer);
    const event = versions.find((v) => v.isEvent === true && v.operationId === 'reject-1');
    expect({ role: event?.authorRole, note: event?.note }).toEqual({ role: JobVersionAuthorRole.CUSTOMER, note: 'Rejected by the customer' });
  });

  it('puts the graph back to the customer’s own last version, dropping the lab’s edits', async () => {
    // Seeded v1000 CUSTOMER, v1001 STAFF: the lab edited and asked for approval.
    // Refusing that has to undo it, or the job returns to the lab still carrying
    // the very changes the customer just refused.
    const { service, restores, sowSyncs } = buildHarness(awaitingApproval);

    await service.rejectJobReview(reject, customer);

    expect(restores).toEqual([{ versionNumber: 1000, note: 'Rejected the lab’s changes', authorRole: JobVersionAuthorRole.CUSTOMER, visibleToCustomer: true }]);
    // The live graph moved, so the SOW's billing core has to follow it.
    expect(sowSyncs).toEqual([JOB_ID]);
  });

  it('restores nothing when the lab asked for approval without editing anything', async () => {
    // Appending a version identical to the one below it would read as an edit
    // the customer never made.
    const { service, restores } = buildHarness(awaitingApproval, {
      seedVersions: [{ _id: 'content-1000', jobId: JOB_ID, versionNumber: 1000, authorRole: JobVersionAuthorRole.CUSTOMER, workflows: VERSION_WORKFLOWS, visibleToCustomer: true, isEvent: false }]
    });

    await service.rejectJobReview(reject, customer);

    expect(restores).toEqual([]);
  });

  it('falls back to the original submission on a job the lab submitted on their behalf', async () => {
    // Every version is STAFF-authored, so there is no customer version to go
    // back to and the first submission is the only thing "before the lab's
    // edits" can mean.
    const { service, restores } = buildHarness(awaitingApproval, {
      seedVersions: [
        {
          _id: 'content-1000',
          jobId: JOB_ID,
          versionNumber: 1000,
          authorRole: JobVersionAuthorRole.STAFF,
          workflows: [{ name: 'as submitted', nodes: [], edges: [] }],
          visibleToCustomer: true,
          isEvent: false
        },
        { _id: 'content-1001', jobId: JOB_ID, versionNumber: 1001, authorRole: JobVersionAuthorRole.STAFF, workflows: VERSION_WORKFLOWS, visibleToCustomer: true, isEvent: false }
      ]
    });

    await service.rejectJobReview(reject, customer);

    expect(restores.map((r: any) => r.versionNumber)).toEqual([1000]);
  });

  it('restores once however many times the submit is retried', async () => {
    const { service, restores } = buildHarness(awaitingApproval);

    await service.rejectJobReview(reject, customer);
    await service.rejectJobReview(reject, customer);

    expect(restores).toHaveLength(1);
  });

  it('does not announce a revert it has not performed', async () => {
    // The comment tells the lab the changes were refused; it must not land
    // before the graph has actually moved back.
    const { service, restores, comments } = buildHarness(awaitingApproval);

    await service.rejectJobReview(reject, customer);

    expect(restores).toHaveLength(1);
    expect(comments).toHaveLength(1);
  });

  it('refuses a job that is not awaiting the customer’s approval', async () => {
    // Editing and replying are different asks; rejecting is only offered against
    // an approval request, and the server has to agree with that.
    for (const overrides of [{ state: JobState.SUBMITTED }, { state: JobState.CHANGES_REQUESTED, customerActionRequired: CustomerActionRequired.EDIT_WORKFLOW }]) {
      const { service } = buildHarness(overrides);
      await expect(service.rejectJobReview(reject, customer)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('refuses someone who does not own the job', async () => {
    const { service } = buildHarness(awaitingApproval);
    await expect(service.rejectJobReview(reject, staff)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a reason', async () => {
    const { service } = buildHarness(awaitingApproval);
    await expect(service.rejectJobReview({ ...reject, reason: '   ' }, customer)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('cancelJob', () => {
  const cancel = { operationId: 'cancel-1', jobId: JOB_ID, reason: 'Grant fell through.' };

  it.each([
    ['submitted', { state: JobState.SUBMITTED }, undefined],
    ['with the customer', awaitingApproval, undefined],
    ['accepted with the SOW out for signature', { state: JobState.ACCEPTED }, 'SENT'],
    ['accepted with the SOW signed by the client alone', { state: JobState.ACCEPTED }, 'SIGNED']
  ])('cancels a job %s', async (_label, overrides, sowStatus) => {
    const { service, job } = buildHarness(overrides, { sowStatus: sowStatus as string | undefined });
    await service.cancelJob(cancel, customer);
    expect(job.state).toBe(JobState.CANCELLED);
  });

  it('refuses once the SOW is countersigned — that is an agreement between both parties', async () => {
    const { service, job } = buildHarness({ state: JobState.ACCEPTED }, { sowStatus: 'FINAL' });
    await expect(service.cancelJob(cancel, customer)).rejects.toBeInstanceOf(BadRequestException);
    expect(job.state).toBe(JobState.ACCEPTED);
  });

  it('cancels the standing SOW with the job, so nothing is left signable', async () => {
    const { service, sowCancels } = buildHarness({ state: JobState.ACCEPTED }, { sowStatus: 'SENT' });
    await service.cancelJob(cancel, customer);
    expect(sowCancels).toEqual([{ jobId: JOB_ID, note: 'Grant fell through.' }]);
  });

  it('is idempotent on a replayed submit', async () => {
    const { service, comments, activityEvents, sowCancels } = buildHarness({ state: JobState.ACCEPTED }, { sowStatus: 'SENT' });
    await service.cancelJob(cancel, customer);
    await service.cancelJob(cancel, customer);
    expect({ comments: comments.length, activity: activityEvents.length, sowCancels: sowCancels.length }).toEqual({ comments: 1, activity: 1, sowCancels: 1 });
  });

  it('refuses a non-owner, a closed job, and an already-cancelled one', async () => {
    const { service } = buildHarness({ state: JobState.SUBMITTED });
    await expect(service.cancelJob(cancel, staff)).rejects.toBeInstanceOf(ForbiddenException);
    for (const state of [JobState.CLOSED, JobState.CANCELLED]) {
      const harness = buildHarness({ state });
      await expect(harness.service.cancelJob(cancel, customer)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('requires a reason', async () => {
    const { service } = buildHarness({ state: JobState.SUBMITTED });
    await expect(service.cancelJob({ ...cancel, reason: '' }, customer)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('requestJobEditAccess', () => {
  const request = { operationId: 'edit-req-1', jobId: JOB_ID, message: 'I need to add a sample.' };

  it('records the request without moving the job — staff still have to grant it', async () => {
    const { service, job } = buildHarness({ state: JobState.ACCEPTED });
    await service.requestJobEditAccess(request, customer);
    expect({ state: job.state, requested: job.editAccessRequestedAt instanceof Date }).toEqual({ state: JobState.ACCEPTED, requested: true });
  });

  it('is available with no message at all', async () => {
    const { service, comments } = buildHarness({ state: JobState.ACCEPTED });
    await service.requestJobEditAccess({ operationId: 'edit-req-2', jobId: JOB_ID }, customer);
    expect(comments).toEqual([expect.objectContaining({ authorType: 'CLIENT', content: 'Customer requested access to edit this job' })]);
  });

  it('is idempotent on a replayed submit', async () => {
    const { service, comments, activityEvents } = buildHarness({ state: JobState.ACCEPTED });
    await service.requestJobEditAccess(request, customer);
    await service.requestJobEditAccess(request, customer);
    expect({ comments: comments.length, activity: activityEvents.length }).toEqual({ comments: 1, activity: 1 });
  });

  it.each(['SIGNED', 'FINAL'])('refuses once the SOW is %s', async (sowStatus) => {
    const { service } = buildHarness({ state: JobState.ACCEPTED }, { sowStatus });
    await expect(service.requestJobEditAccess(request, customer)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses when the customer already holds edit access', async () => {
    const { service } = buildHarness({ state: JobState.CHANGES_REQUESTED, customerActionRequired: CustomerActionRequired.EDIT_WORKFLOW });
    await expect(service.requestJobEditAccess(request, customer)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a non-owner and a job that is no longer open', async () => {
    const { service } = buildHarness({ state: JobState.ACCEPTED });
    await expect(service.requestJobEditAccess(request, staff)).rejects.toBeInstanceOf(ForbiddenException);
    for (const state of [JobState.CLOSED, JobState.CANCELLED]) {
      const harness = buildHarness({ state });
      await expect(harness.service.requestJobEditAccess(request, customer)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('is retired by the next staff review decision, so the client is not told a request is still pending', async () => {
    const { service, job } = buildHarness({ state: JobState.SUBMITTED });
    await service.requestJobEditAccess(request, customer);
    expect(job.editAccessRequestedAt).toBeInstanceOf(Date);

    await service.reviewJob({ operationId: 'review-after-request', jobId: JOB_ID, decision: JobReviewDecision.REQUEST_EDITS, message: 'Go ahead.' }, staff);
    expect(job.editAccessRequestedAt ?? null).toBeNull();
  });
});
