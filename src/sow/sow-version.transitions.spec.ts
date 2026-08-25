import { BadRequestException, ConflictException } from '@nestjs/common';
import mongoose from 'mongoose';
import { SowVersionService } from './sow-version.service';
import { SowFieldKind } from './sow-version.model';
import { SOWStatus, DocumentBlocker, SOWAdjustmentType } from './sow.model';
import { JobState } from '../job/job.model';
import { User } from '../auth/user.interface';
import { JobVersionAuthorRole } from '../job-version/job-version.model';

/**
 * Exercises the version state machine against in-memory stand-ins for the two
 * mongoose models. The rule that matters most here is that saving never moves
 * activeVersionNumber: that is what lets staff iterate on a signed SOW without
 * invalidating the signature, and it is invisible to a type checker.
 */

const SOW_ID = new mongoose.Types.ObjectId().toHexString();

interface FakeVersion {
  _id: string;
  sowId: string;
  versionNumber: number;
  fields: any[];
  inputs: any;
  status: SOWStatus;
  visibleToCustomer: boolean;
  isDiscarded: boolean;
  isStaged?: boolean;
  clientSignature?: any;
  staffSignature?: any;
  sentToCustomerAt?: Date;
  sourceJobVersionNumber?: number;
  activityEventType?: 'SOW_SENT' | 'SOW_SIGNED' | 'SOW_FINALIZED';
  activityOperationId?: string;
  activityDeliveredAt?: Date;
  note?: string;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
}

function matches(doc: any, query: Record<string, any>): boolean {
  return Object.entries(query).every(([k, v]) => {
    // Only the operators the service actually uses. `$ne: true` is how every
    // staged-row filter is written, so that absent fields on rows predating
    // isStaged match without a backfill — the fake has to honour that or the
    // tests would not be exercising the real query.
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return String(doc[k]) !== String(v.$ne);
      if ('$exists' in v) return (doc[k] !== undefined && doc[k] !== null) === v.$exists;
    }
    return String(doc[k]) === String(v);
  });
}

const acceptedWorkflows = [
  {
    workflowId: 'workflow-1',
    name: 'PCR',
    nodes: [{ id: 'node-1', serviceId: 'service-1', formData: [{ id: 'volume', value: 10 }], additionalInstructions: 'Handle gently', price: 100, position: { x: 10, y: 20 } }],
    edges: []
  }
];

function makeHarness(initial: { status?: SOWStatus; fields?: any[]; job?: any; liveFingerprint?: string } = {}): {
  service: SowVersionService;
  sow: any;
  versions: FakeVersion[];
  job: any;
  jobVersions: any[];
  activityEvents: any[];
  comments: any[];
  race: { beforeSowCas?: () => void; failPromotion?: boolean; failActivity?: boolean; failCleanup?: boolean };
} {
  const race: { beforeSowCas?: () => void; failPromotion?: boolean; failActivity?: boolean; failCleanup?: boolean } = {};
  const activityEvents: any[] = [];
  const versions: FakeVersion[] = [
    {
      _id: 'v1',
      sowId: SOW_ID,
      versionNumber: 1,
      fields: initial.fields ?? [
        { key: 'billToAddress', label: 'Bill To Address', kind: SowFieldKind.PROSE, order: 110, value: 'x', isOverridden: false, isEnabled: true, allowsTextOverride: true },
        { key: 'feeSchedule', label: 'Fee Schedule', kind: SowFieldKind.CALCULATED, order: 100, value: 'Total: $0.00', isOverridden: false, isEnabled: true, allowsTextOverride: false },
        // Required before send — see sow-field-defaults.ts's allowsEmpty.
        {
          key: 'engagementResources',
          label: 'Engagement Resources',
          kind: SowFieldKind.CALCULATED,
          order: 50,
          value: 'Jane Doe – Project Manager',
          isOverridden: false,
          isEnabled: true,
          allowsTextOverride: true,
          allowsEmpty: false
        }
      ],
      inputs: {
        services: [],
        adjustments: [],
        baseCost: 0,
        totalCost: 0,
        periods: [],
        scopeOfWork: [],
        deliverables: [],
        projectManager: '',
        projectLead: '',
        customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC'
      },
      status: initial.status ?? SOWStatus.DRAFT,
      visibleToCustomer: false,
      isDiscarded: false,
      sourceJobVersionNumber: 1000,
      createdBy: 'tech',
      createdByName: 'tech',
      createdAt: new Date()
    }
  ];

  const sow: any = {
    _id: SOW_ID,
    jobId: 'job-1',
    sowNumber: 'SOW 001',
    currentVersionNumber: 1,
    activeVersionNumber: 0,
    status: initial.status ?? SOWStatus.DRAFT,
    documentStale: false,
    services: [],
    pricing: { baseCost: 0, adjustments: [], totalCost: 0 },
    timeline: { startDate: new Date('2026-03-03T00:00:00Z'), duration: '14 days' },
    resources: { projectManager: '', projectLead: '' },
    scopeOfWork: [],
    deliverables: []
  };

  const versionModel: any = {
    findOne: (q: any): any => {
      const found = versions.filter((v) => matches(v, q));
      const api = {
        sort: (spec: any): any => {
          const key = Object.keys(spec)[0];
          const dir = spec[key];
          const sorted = [...found].sort((a: any, b: any) => (a[key] - b[key]) * dir);
          return { exec: async () => sorted[0] ?? null };
        },
        exec: async () => found[0] ?? null
      };
      return api;
    },
    find: (q: any): any => ({
      sort: (spec: any): any => {
        const key = Object.keys(spec)[0];
        const dir = spec[key];
        return { exec: async () => versions.filter((v) => matches(v, q)).sort((a: any, b: any) => (a[key] - b[key]) * dir) };
      },
      exec: async () => versions.filter((v) => matches(v, q))
    }),
    countDocuments: (q: any): any => ({
      exec: async (): Promise<number> => {
        const { versionNumber, ...rest } = q ?? {};
        const ne = versionNumber?.$ne;
        return versions.filter((v) => matches(v, rest) && (ne === undefined || v.versionNumber !== ne)).length;
      }
    }),
    create: async (doc: any): Promise<any> => {
      const created = { ...doc, _id: `v${doc.versionNumber}`, sowId: String(doc.sowId) };
      versions.push(created);
      return created;
    },
    updateOne: (q: any, u: any): any => ({
      exec: async (): Promise<void> => {
        if (race.failPromotion && u.$set?.isStaged === false) {
          race.failPromotion = false;
          throw new Error('simulated staged-row promotion failure');
        }
        const target = versions.find((v) => matches(v, q));
        if (target) Object.assign(target, u.$set ?? {});
      }
    }),
    deleteOne: (q: any): any => ({
      exec: async (): Promise<void> => {
        if (race.failCleanup) {
          race.failCleanup = false;
          throw new Error('simulated staged-row cleanup failure');
        }
        const index = versions.findIndex((version) => matches(version, q));
        if (index >= 0) versions.splice(index, 1);
      }
    })
  };

  const sowModel: any = {
    findById: (): any => ({ exec: async (): Promise<any> => sow }),
    findOneAndUpdate: (q: any, u: any): any => ({
      exec: async (): Promise<any> => {
        const beforeCas = race.beforeSowCas;
        race.beforeSowCas = undefined;
        beforeCas?.();
        if (!matches(sow, q)) return null;
        Object.assign(sow, u.$set ?? {});
        return sow;
      }
    }),
    findByIdAndUpdate: (_id: any, u: any): any => ({
      exec: async (): Promise<any> => {
        Object.assign(sow, u.$set ?? {});
        return sow;
      }
    })
  };

  // Accepted, and unchanged since — the state a job has to be in for a send to
  // be allowed at all. Tests that care about the gate override it.
  const job: any = {
    customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC',
    jobId: '04217',
    sub: 'sub-owner',
    email: 'client@lab.org',
    state: JobState.ACCEPTED,
    acceptedJobVersionNumber: 1000,
    acceptedBillingFingerprint: 'fp-accepted',
    ...(initial.job ?? {})
  };
  const jobVersions: any[] = [
    {
      versionNumber: 1000,
      authorRole: JobVersionAuthorRole.CUSTOMER,
      workflows: acceptedWorkflows,
      visibleToCustomer: true,
      isEvent: false
    }
  ];

  const sowService: any = {
    applyDocumentBilling: async () => sow,
    getJobForSow: async () => job,
    jobBillingFingerprint: async () => initial.liveFingerprint ?? 'fp-accepted',
    autoAssignProjectLead: async () => undefined
  };

  // No blocks: prose falls back to SOW_PROSE_DEFAULTS, which is what these
  // transition tests assert against.
  const presetService: any = { defaultTextByKey: async () => ({}) };
  const jobVersionService: any = {
    getContentVersion: async (_jobId: string, versionNumber: number) => jobVersions.find((version) => version.versionNumber === versionNumber && version.isEvent !== true) ?? null,
    getLatestContentVersion: async () => [...jobVersions].filter((version) => version.isEvent !== true).sort((a, b) => b.versionNumber - a.versionNumber)[0] ?? null
  };
  const activityService: any = {
    createEventIdempotent: async (input: any) => {
      if (race.failActivity) {
        race.failActivity = false;
        throw new Error('simulated activity failure');
      }
      const existing = activityEvents.find((event) => event.operationId === input.operationId);
      if (existing) return existing;
      const created = { _id: `activity-${input.operationId}`, ...input };
      activityEvents.push(created);
      return created;
    }
  };
  const comments: any[] = [];
  const commentService: any = {
    createIdempotent: async (input: any) => {
      const existing = comments.find((comment) => comment.operationId === input.operationId);
      if (existing) return existing;
      const created = { _id: `comment-${comments.length}`, ...input };
      comments.push(created);
      return created;
    }
  };

  const service = new (SowVersionService as any)(versionModel, sowModel, sowService, presetService, activityService, jobVersionService, commentService);

  return { service, sow, versions, job, jobVersions, activityEvents, comments, race };
}

const staff = { sub: 'sub-staff', name: 'tech' };
const owner = { sub: 'sub-owner', email: 'client@lab.org', preferred_username: 'jane', realm_access: { roles: [] } } as User;

// A note is required on every save, so the default stands in for one the test
// does not care about; the tests that do care pass their own.
const saveInput = (base: number, note = 'edited'): any => ({
  baseVersionNumber: base,
  note,
  // The real editor always resubmits its whole local field set, never a subset —
  // this mirrors that so a save doesn't drop Engagement Resources back to
  // disabled the way an actually-partial request deliberately does.
  fields: [
    { key: 'billToAddress', value: 'edited', isEnabled: true },
    { key: 'engagementResources', value: 'PM – Project Manager\nPL – Project Lead', isEnabled: true }
  ],
  inputs: { projectManager: 'PM', projectLead: 'PL', periods: [], scopeOfWork: [], deliverables: [], services: [], adjustments: [] }
});

const fullConsent = [SowFieldKind.CALCULATED, SowFieldKind.PROSE, SowFieldKind.CUSTOM];
const acceptedSourceUnavailable = 'ACCEPTED_SOURCE_UNAVAILABLE' as DocumentBlocker;

describe('saveVersion', () => {
  it('stamps a new initial version with the exact valid accepted job source', async () => {
    const { service, sow, versions, job } = makeHarness();
    versions.splice(0);

    const created = await service.createInitialVersion(sow, job, staff.sub);

    expect((created as any).sourceJobVersionNumber).toBe(1000);
  });

  it('leaves source linkage nullable when the accepted source is not valid', async () => {
    const { service, sow, versions, jobVersions, job } = makeHarness();
    versions.splice(0);
    jobVersions[0].authorRole = JobVersionAuthorRole.STAFF;
    jobVersions[0].visibleToCustomer = false;

    const created = await service.createInitialVersion(sow, job, staff.sub);

    expect((created as any).sourceJobVersionNumber).toBeUndefined();
  });

  it('appends a draft and advances the staff pointer only', async () => {
    const { service, sow } = makeHarness();
    const v = await service.saveVersion(SOW_ID, saveInput(1, 'first pass'), staff);

    expect(v.versionNumber).toBe(2);
    expect(v.status).toBe(SOWStatus.DRAFT);
    expect(v.visibleToCustomer).toBe(false);
    expect(sow.currentVersionNumber).toBe(2);
    expect(sow.activeVersionNumber).toBe(0);
  });

  it('restamps a saved draft from the currently valid accepted job source', async () => {
    const { service, job, jobVersions } = makeHarness();
    const revisedWorkflows = [
      {
        ...acceptedWorkflows[0],
        nodes: [{ ...acceptedWorkflows[0].nodes[0], formData: [{ id: 'volume', value: 20 }] }]
      }
    ];
    jobVersions.push({ versionNumber: 1001, authorRole: JobVersionAuthorRole.STAFF, workflows: revisedWorkflows, visibleToCustomer: true, isEvent: false });
    job.acceptedJobVersionNumber = 1001;

    const created = await service.saveVersion(SOW_ID, saveInput(1), staff);

    expect((created as any).sourceJobVersionNumber).toBe(1001);
  });

  it('rejects a save built on a version someone else has superseded', async () => {
    const { service } = makeHarness();
    await service.saveVersion(SOW_ID, saveInput(1), staff);
    await expect(service.saveVersion(SOW_ID, saveInput(1), { sub: 'other', name: 'other' })).rejects.toThrow(ConflictException);
  });

  it('clears the stale flag, since the saved document now matches the billing core', async () => {
    const { service, sow } = makeHarness();
    sow.documentStale = true;
    await service.saveVersion(SOW_ID, saveInput(1), staff);
    expect(sow.documentStale).toBe(false);
  });

  it('rejects a save whose note is only whitespace', async () => {
    // The schema stops a missing note; this is the one that would otherwise slip
    // through typed and still leave the history entry unlabelled.
    const { service } = makeHarness();
    await expect(service.saveVersion(SOW_ID, saveInput(1, '   '), staff)).rejects.toThrow(BadRequestException);
  });

  it('still lets the canned event versions through without an author note', async () => {
    // sendToCustomer/sign/finalize write via appendVersion, not the save input,
    // so requiring a note on saves must not reach them.
    const { service } = makeHarness();
    const sent = await service.sendToCustomer(SOW_ID, staff);
    expect(sent.note).toBe('Sent to customer');
  });
});

describe('sendToCustomer', () => {
  it('emits exact retry-safe activity for send, sign, and finalize versions', async () => {
    const { service, sow, activityEvents } = makeHarness();

    const sent = await service.sendToCustomer(SOW_ID, staff);
    const signed = await service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: 'Jane Rivera', consentedGroups: fullConsent }, owner);
    const final = await service.finalize(SOW_ID, 'Courtney Tretheway', staff);
    await service.getCurrentVersion(SOW_ID);

    expect(activityEvents).toEqual([
      expect.objectContaining({
        type: 'SOW_SENT',
        operationId: `SOW_SENT:${SOW_ID}:${sent.versionNumber}`,
        jobId: sow.jobId,
        sowId: SOW_ID,
        sowVersionNumber: sent.versionNumber,
        actorDisplayName: staff.name
      }),
      expect.objectContaining({
        type: 'SOW_SIGNED',
        operationId: `SOW_SIGNED:${SOW_ID}:${signed.versionNumber}`,
        jobId: sow.jobId,
        sowId: SOW_ID,
        sowVersionNumber: signed.versionNumber,
        actorDisplayName: 'Jane Rivera'
      }),
      expect.objectContaining({
        type: 'SOW_FINALIZED',
        operationId: `SOW_FINALIZED:${SOW_ID}:${final.versionNumber}`,
        jobId: sow.jobId,
        sowId: SOW_ID,
        sowVersionNumber: final.versionNumber,
        actorDisplayName: staff.name
      })
    ]);
  });

  it('keeps a failed activity delivery pending and repairs it on the next reconcile, not on a read', async () => {
    const { service, versions, activityEvents, race } = makeHarness();
    race.failActivity = true;

    const sent = await service.sendToCustomer(SOW_ID, staff);

    expect(sent).toMatchObject({
      status: SOWStatus.SENT,
      activityEventType: 'SOW_SENT',
      activityOperationId: `SOW_SENT:${SOW_ID}:${sent.versionNumber}`
    });
    expect((sent as any).activityDeliveredAt).toBeUndefined();
    expect(activityEvents).toHaveLength(0);

    // Reads are pure now: they must not repair anything.
    await service.getCurrentVersion(SOW_ID);
    await service.getCurrentVersion(SOW_ID);
    expect(activityEvents).toHaveLength(0);

    // Repair is what reconcile is for — and it stays idempotent across retries.
    await service.reconcile(SOW_ID);
    await service.reconcile(SOW_ID);

    expect(versions.find((version) => version.versionNumber === sent.versionNumber)?.activityDeliveredAt).toBeInstanceOf(Date);
    expect(activityEvents).toHaveLength(1);
  });

  it('copies source linkage unchanged across send, sign, and finalize events', async () => {
    const { service, sow } = makeHarness();

    const sent = await service.sendToCustomer(SOW_ID, staff);
    const signed = await service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: 'Jane Rivera', consentedGroups: fullConsent }, owner);
    const final = await service.finalize(SOW_ID, 'Courtney Tretheway', staff);

    for (const version of [sent, signed, final]) {
      expect((version as any).sourceJobVersionNumber).toBe(1000);
    }
  });

  it('issues the draft and moves the customer pointer', async () => {
    const { service, sow } = makeHarness();
    const v = await service.sendToCustomer(SOW_ID, staff);

    expect(v.status).toBe(SOWStatus.SENT);
    expect(v.visibleToCustomer).toBe(true);
    expect(v.sentToCustomerAt).toBeInstanceOf(Date);
    expect(sow.activeVersionNumber).toBe(v.versionNumber);
  });

  it('refuses to send anything but a draft', async () => {
    const { service } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    await expect(service.sendToCustomer(SOW_ID, staff)).rejects.toThrow(BadRequestException);
  });
});

describe('sign', () => {
  async function sent(): Promise<ReturnType<typeof makeHarness>> {
    const h = makeHarness();
    await h.service.sendToCustomer(SOW_ID, staff);
    return h;
  }

  it('records the signature and moves the pointer', async () => {
    const { service, sow } = await sent();
    const active = sow.activeVersionNumber;
    const v = await service.sign(SOW_ID, { versionNumber: active, name: 'Jane Rivera', consentedGroups: fullConsent }, owner);

    expect(v.status).toBe(SOWStatus.SIGNED);
    expect(v.clientSignature?.name).toBe('Jane Rivera');
    expect(v.clientSignature?.bySub).toBe('sub-owner');
    expect(sow.activeVersionNumber).toBe(v.versionNumber);
  });

  it('refuses a signature aimed at a superseded version', async () => {
    const { service, sow } = await sent();
    await expect(service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber - 1, name: 'Jane', consentedGroups: fullConsent }, owner)).rejects.toThrow(ConflictException);
  });

  // Staff can no longer draft over a sent version, so the way a customer loses
  // the ability to sign is an explicit withdrawal — which they are told about.
  it('stops the customer signing once staff withdraw, and lets them sign the reissue', async () => {
    const { service, sow, versions } = await sent();
    const withdrawnNumber = sow.activeVersionNumber;

    await service.withdrawFromCustomer(SOW_ID, 'Reworking.', staff);

    const gate = await service.actionGate(SOW_ID, withdrawnNumber);
    expect(gate.canSign).toBe(false);
    const versionCountBeforeRejectedSign = versions.length;
    await expect(service.sign(SOW_ID, { versionNumber: withdrawnNumber, name: 'Jane', consentedGroups: fullConsent }, owner)).rejects.toThrow();
    expect(versions).toHaveLength(versionCountBeforeRejectedSign);

    const reissued = await service.sendToCustomer(SOW_ID, staff);
    const signed = await service.sign(SOW_ID, { versionNumber: reissued.versionNumber, name: 'Jane', consentedGroups: fullConsent }, owner);
    expect(signed.status).toBe(SOWStatus.SIGNED);
    expect(sow.activeVersionNumber).toBe(signed.versionNumber);
  });

  it('requires every group present in the document to be acknowledged', async () => {
    const { service, sow } = await sent();
    // The document has PROSE and CALCULATED sections; consenting to one is not enough.
    await expect(service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: 'Jane', consentedGroups: [SowFieldKind.PROSE] }, owner)).rejects.toThrow(/Missing/);
  });

  it('ignores groups that only appear in disabled sections', async () => {
    const h = makeHarness({
      fields: [
        { key: 'billToAddress', kind: SowFieldKind.PROSE, order: 110, value: 'x', isEnabled: true, allowsTextOverride: true, label: 'b', isOverridden: false },
        // Required, so it must stay enabled for sendToCustomer to succeed — it is
        // the CALCULATED section present, not custom-1, which stays disabled.
        {
          key: 'engagementResources',
          kind: SowFieldKind.CALCULATED,
          order: 50,
          value: 'Jane Doe – Project Manager',
          isEnabled: true,
          allowsTextOverride: true,
          allowsEmpty: false,
          label: 'Engagement Resources',
          isOverridden: false
        },
        { key: 'custom-1', kind: SowFieldKind.CUSTOM, order: 1000, value: 'hidden', isEnabled: false, allowsTextOverride: true, label: 'c', isOverridden: false }
      ]
    });
    await h.service.sendToCustomer(SOW_ID, staff);
    const v = await h.service.sign(SOW_ID, { versionNumber: h.sow.activeVersionNumber, name: 'Jane', consentedGroups: [SowFieldKind.PROSE, SowFieldKind.CALCULATED] }, owner);
    expect(v.status).toBe(SOWStatus.SIGNED);
  });

  it('requires initials on a section staff flagged, and refuses to sign without them', async () => {
    const h = makeHarness({
      fields: [
        { key: 'billToAddress', kind: SowFieldKind.PROSE, order: 110, value: 'x', isEnabled: true, allowsTextOverride: true, label: 'b', isOverridden: false },
        {
          key: 'clientResponsibilities',
          kind: SowFieldKind.PROSE,
          order: 90,
          value: 'Ships samples on dry ice.',
          isEnabled: true,
          allowsTextOverride: true,
          label: 'Client Responsibilities',
          isOverridden: false,
          requiresInitials: true
        },
        {
          key: 'engagementResources',
          kind: SowFieldKind.CALCULATED,
          order: 50,
          value: 'Jane Doe – Project Manager',
          isEnabled: true,
          allowsTextOverride: true,
          allowsEmpty: false,
          label: 'Engagement Resources',
          isOverridden: false
        }
      ]
    });
    await h.service.sendToCustomer(SOW_ID, staff);

    await expect(h.service.sign(SOW_ID, { versionNumber: h.sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner)).rejects.toThrow(/initial/i);

    const v = await h.service.sign(
      SOW_ID,
      { versionNumber: h.sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent, sectionInitials: [{ key: 'clientResponsibilities', initials: 'JR' }] },
      owner
    );
    expect(v.status).toBe(SOWStatus.SIGNED);
    expect(v.clientSignature?.sectionInitials).toEqual([{ key: 'clientResponsibilities', label: 'Client Responsibilities', initials: 'JR' }]);
  });

  it('ignores a requiresInitials flag on a section the staff hid', async () => {
    const h = makeHarness({
      fields: [
        { key: 'billToAddress', kind: SowFieldKind.PROSE, order: 110, value: 'x', isEnabled: true, allowsTextOverride: true, label: 'b', isOverridden: false },
        {
          key: 'clientResponsibilities',
          kind: SowFieldKind.PROSE,
          order: 90,
          value: 'x',
          isEnabled: false,
          allowsTextOverride: true,
          label: 'Client Responsibilities',
          isOverridden: false,
          requiresInitials: true
        },
        {
          key: 'engagementResources',
          kind: SowFieldKind.CALCULATED,
          order: 50,
          value: 'Jane Doe – Project Manager',
          isEnabled: true,
          allowsTextOverride: true,
          allowsEmpty: false,
          label: 'Engagement Resources',
          isOverridden: false
        }
      ]
    });
    await h.service.sendToCustomer(SOW_ID, staff);
    const v = await h.service.sign(SOW_ID, { versionNumber: h.sow.activeVersionNumber, name: 'Jane', consentedGroups: [SowFieldKind.PROSE, SowFieldKind.CALCULATED] }, owner);
    expect(v.status).toBe(SOWStatus.SIGNED);
  });

  it('requires a typed name', async () => {
    const { service, sow } = await sent();
    await expect(service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: '   ', consentedGroups: fullConsent }, owner)).rejects.toThrow(BadRequestException);
  });

  it('cannot sign a draft that was never sent', async () => {
    const { service } = makeHarness();
    await expect(service.sign(SOW_ID, { versionNumber: 1, name: 'Jane', consentedGroups: fullConsent }, owner)).rejects.toThrow(BadRequestException);
  });
});

describe('finalize and the draft-above-final rule', () => {
  async function finalized(): Promise<ReturnType<typeof makeHarness>> {
    const h = makeHarness();
    await h.service.sendToCustomer(SOW_ID, staff);
    await h.service.sign(SOW_ID, { versionNumber: h.sow.activeVersionNumber, name: 'Jane Rivera', consentedGroups: fullConsent }, owner);
    await h.service.finalize(SOW_ID, 'Courtney Tretheway', staff);
    return h;
  }

  it('countersigns a signed SOW', async () => {
    const { sow, versions } = await finalized();
    const final = versions.find((v) => v.versionNumber === sow.activeVersionNumber);
    expect(final?.status).toBe(SOWStatus.FINAL);
    expect(final?.staffSignature?.name).toBe('Courtney Tretheway');
    // the customer signature carries forward onto the final record
    expect(final?.clientSignature?.name).toBe('Jane Rivera');
  });

  it('refuses to finalize anything but a signed SOW', async () => {
    const { service } = makeHarness();
    await expect(service.finalize(SOW_ID, 'Someone', staff)).rejects.toThrow(BadRequestException);
  });

  it('keeps the finalized version in force and refuses to draft over it', async () => {
    const { service, sow } = await finalized();
    const finalNumber = sow.activeVersionNumber;

    // An executed contract is not edited; it is cancelled and replaced.
    await expect(service.saveVersion(SOW_ID, saveInput(sow.currentVersionNumber, 'proposed revision'), staff)).rejects.toThrow(/countersigned and is final/);
    expect(sow.activeVersionNumber).toBe(finalNumber);
  });
});

describe('editing a document that is out with the customer', () => {
  // The rule the whole change exists for: exactly one party holds the document,
  // and staff take it back explicitly rather than drafting over it.
  it('refuses to save over a version the customer is being asked to sign', async () => {
    const { service, sow } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);

    await expect(service.saveVersion(SOW_ID, saveInput(sow.currentVersionNumber, 'sneak an edit in'), staff)).rejects.toThrow(/Withdraw it before editing/);
  });

  it('withdraws, edits, and reissues', async () => {
    const { service, sow, comments, versions } = makeHarness();
    const sent = await service.sendToCustomer(SOW_ID, staff);

    await service.withdrawFromCustomer(SOW_ID, 'Pricing was wrong.', staff);
    expect(sow.status).toBe(SOWStatus.DRAFT);
    // Nothing is in force with the customer any more, so nothing can be signed.
    expect(sow.activeVersionNumber).toBe(0);
    expect(await service.getActiveVersion(SOW_ID)).toBeNull();
    expect(comments[0].content).toContain('Pricing was wrong.');
    // The sent version is immutable and stays in history.
    expect(versions.find((version) => version.versionNumber === sent.versionNumber)?.status).toBe(SOWStatus.SENT);

    const draft = await service.saveVersion(SOW_ID, saveInput(sow.currentVersionNumber, 'corrected pricing'), staff);
    expect(draft.status).toBe(SOWStatus.DRAFT);

    const reissued = await service.sendToCustomer(SOW_ID, staff);
    expect(reissued.status).toBe(SOWStatus.SENT);
    expect(sow.activeVersionNumber).toBe(reissued.versionNumber);
  });

  it('refuses to withdraw a document that is not out for signature', async () => {
    const { service } = makeHarness();
    await expect(service.withdrawFromCustomer(SOW_ID, 'why', staff)).rejects.toThrow(/out for signature can be withdrawn/);
  });

  it('requires a reason to withdraw', async () => {
    const { service } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    await expect(service.withdrawFromCustomer(SOW_ID, '  ', staff)).rejects.toThrow(/reason/i);
  });

  // A signature attests to specific words. Saving a revision is allowed — staff
  // often need to — but the signed version stays in force until they send the
  // new draft (or restore it and countersign). Voiding on save left no way back.
  it('keeps the client signature in force when staff save a draft above a signed version', async () => {
    const { service, sow, comments } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    await service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner);
    expect(sow.status).toBe(SOWStatus.SIGNED);
    const signedNumber = sow.activeVersionNumber;

    const draft = await service.saveVersion(SOW_ID, saveInput(sow.currentVersionNumber, 'revise after signature'), staff);

    expect(draft.status).toBe(SOWStatus.DRAFT);
    expect(draft.clientSignature).toBeUndefined();
    expect(sow.activeVersionNumber).toBe(signedNumber);
    expect(comments.some((comment) => comment.content.includes('no longer applies'))).toBe(false);
    expect((await service.actionGate(SOW_ID)).countersignBlockers).toEqual([DocumentBlocker.UNSENT_DRAFT]);
  });

  it('refuses to edit a countersigned document at all', async () => {
    const { service, sow } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    await service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner);
    await service.finalize(SOW_ID, 'Dr Staff', staff);

    await expect(service.saveVersion(SOW_ID, saveInput(sow.currentVersionNumber, 'revise final'), staff)).rejects.toThrow(/countersigned and is final/);
  });
});

describe('discardDraft', () => {
  it('drops an unsent draft and rolls the staff pointer back', async () => {
    const { service, sow } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff); // v1.0 (1000) SENT
    // Withdrawing hands the lab back an editable copy, v1.1 (1001).
    await service.withdrawFromCustomer(SOW_ID, 'Reworking.', staff);
    const draft = await service.saveVersion(SOW_ID, saveInput(sow.currentVersionNumber), staff); // v1.2 (1002)

    await service.discardDraft(SOW_ID, draft.versionNumber);
    expect(sow.currentVersionNumber).toBe(1001);
  });

  it('refuses to discard a version the customer has seen', async () => {
    const { service, sow } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    await expect(service.discardDraft(SOW_ID, sow.activeVersionNumber)).rejects.toThrow(BadRequestException);
  });

  it('refuses to discard the only version, which would leave the SOW with no document', async () => {
    const { service } = makeHarness();
    // The harness seeds v0.1 (encoded 1) — the very first version of any SOW,
    // whose minor starts at 1 rather than 0 so it never collides with the
    // "nothing sent yet" sentinel activeVersionNumber/currentVersionNumber use.
    await expect(service.discardDraft(SOW_ID, 1)).rejects.toThrow(/only version/i);
  });

  it('does not reopen the editor on the draft that was just discarded', async () => {
    const { service, sow } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff); // v1.0 (1000) SENT
    await service.withdrawFromCustomer(SOW_ID, 'Reworking.', staff); // v1.1 (1001) DRAFT
    const draft = await service.saveVersion(SOW_ID, saveInput(sow.currentVersionNumber), staff); // v1.2 (1002)
    await service.discardDraft(SOW_ID, draft.versionNumber);

    // Back on the withdrawal draft — real content the editor can open, not the
    // issued row and not the draft just thrown away.
    const current = await service.getCurrentVersion(SOW_ID);
    expect(current?.versionNumber).toBe(1001);
    expect(current?.status).toBe(SOWStatus.DRAFT);
  });

  it('does not reuse the discarded number, which would collide on the unique index', async () => {
    const { service } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff); // v1.0 (1000)
    await service.withdrawFromCustomer(SOW_ID, 'Reworking.', staff); // v1.1 (1001)
    const draft = await service.saveVersion(SOW_ID, saveInput(1001), staff); // v1.2 (1002)
    await service.discardDraft(SOW_ID, draft.versionNumber);

    const next = await service.saveVersion(SOW_ID, saveInput(1001), staff);
    // 1002 is still on the books (discarded, not deleted), so the next draft
    // must skip past it to 1.3 (1003) rather than reusing 1.2.
    expect(next.versionNumber).toBe(1003);
  });

  // Only the current draft's discard has to move the pointer. An older unsent
  // draft has no pointer on it, so it must still be discardable — narrowing this
  // to current-only would silently break stacked drafts.
  it('discards an older unsent draft without disturbing the current pointer', async () => {
    const { service, sow, versions } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff); // v1.0 (1000)
    await service.withdrawFromCustomer(SOW_ID, 'Reworking.', staff); // v1.1 (1001)
    const older = await service.saveVersion(SOW_ID, saveInput(1001), staff); // v1.2 (1002)
    const current = await service.saveVersion(SOW_ID, saveInput(1002), staff); // v1.3 (1003)

    await service.discardDraft(SOW_ID, older.versionNumber);

    expect(sow.currentVersionNumber).toBe(current.versionNumber);
    expect(versions.find((version) => version.versionNumber === older.versionNumber)?.isDiscarded).toBe(true);
    await expect(service.getCurrentVersion(SOW_ID)).resolves.toMatchObject({ versionNumber: current.versionNumber });
  });
});

describe('restoreSignedVersion', () => {
  it('discards drafts above the signed version so staff can countersign it', async () => {
    const { service, sow, versions } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    await service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner);
    const signedNumber = sow.activeVersionNumber;
    const firstDraft = await service.saveVersion(SOW_ID, saveInput(sow.currentVersionNumber, 'accidental edit'), staff);
    const secondDraft = await service.saveVersion(SOW_ID, saveInput(firstDraft.versionNumber, 'another edit'), staff);

    const restored = await service.restoreSignedVersion(SOW_ID, signedNumber);

    expect(restored.currentVersionNumber).toBe(signedNumber);
    expect(restored.activeVersionNumber).toBe(signedNumber);
    expect(restored.status).toBe(SOWStatus.SIGNED);
    expect(versions.find((version) => version.versionNumber === firstDraft.versionNumber)?.isDiscarded).toBe(true);
    expect(versions.find((version) => version.versionNumber === secondDraft.versionNumber)?.isDiscarded).toBe(true);
    expect((await service.actionGate(SOW_ID)).canCountersign).toBe(true);

    const finalized = await service.finalize(SOW_ID, 'Dr Staff', staff);
    expect(finalized.status).toBe(SOWStatus.FINAL);
  });

  it('refuses to restore anything but the signed version in force', async () => {
    const { service, sow } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    await expect(service.restoreSignedVersion(SOW_ID, sow.activeVersionNumber)).rejects.toThrow(/signed version in force/);

    await service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner);
    await service.saveVersion(SOW_ID, saveInput(sow.currentVersionNumber, 'revise'), staff);
    await expect(service.restoreSignedVersion(SOW_ID, sow.currentVersionNumber)).rejects.toThrow(/signed version in force/);
  });
});

describe('previewCalculatedValues', () => {
  /** A job can legitimately use the same catalogue service twice at different run counts. */
  const twoPcrLines = [
    { serviceId: 'pcr', name: 'PCR', description: '', cost: 350 }, // 70 runs
    { serviceId: 'pcr', name: 'PCR', description: '', cost: 5 } // 1 run
  ];

  it("quotes the figures the document carries, not the job's current ones", async () => {
    const { service, sow, versions } = makeHarness();
    versions[0].inputs.services = twoPcrLines;
    // The job has since been repriced; the preview must not show this.
    sow.services = [{ serviceId: 'pcr', name: 'PCR', description: '', cost: 999 }];

    const preview = await service.previewCalculatedValues(SOW_ID, {} as any);
    const feeSchedule = preview.find((f) => f.key === 'feeSchedule')?.calculatedValue ?? '';

    // Both lines' costs survive distinctly; a serviceId-keyed lookup would have
    // collapsed them onto one figure and lost the second line's true cost.
    expect(feeSchedule).toContain('$350.00');
    expect(feeSchedule).toContain('$5.00');
    expect(feeSchedule).toContain('Total: $355.00');
    expect(feeSchedule).not.toContain('$999.00');
  });

  it('quotes the job figures once staff have hit Recalculate', async () => {
    const { service, sow, versions } = makeHarness();
    versions[0].inputs.services = twoPcrLines;
    sow.services = [{ serviceId: 'pcr', name: 'PCR', description: '', cost: 999 }];

    const preview = await service.previewCalculatedValues(SOW_ID, { refreshFeeSchedule: true } as any);
    const feeSchedule = preview.find((f) => f.key === 'feeSchedule')?.calculatedValue ?? '';

    expect(feeSchedule).toContain('$999.00');
    expect(feeSchedule).toContain('Total: $999.00');
  });

  it('ignores service figures a client sends, whatever they are', async () => {
    const { service, versions } = makeHarness();
    versions[0].inputs.services = twoPcrLines;

    const preview = await service.previewCalculatedValues(SOW_ID, {
      services: [{ serviceId: 'pcr', name: 'PCR', description: '', cost: 1 }]
    } as any);
    const feeSchedule = preview.find((f) => f.key === 'feeSchedule')?.calculatedValue ?? '';

    expect(feeSchedule).toContain('Total: $355.00');
  });
});

/**
 * The send gate.
 *
 * One rule for the whole lifecycle: the spec must be agreed (accepted, and
 * unchanged since) and the document must match it. The signed-SOW block at the
 * end runs the same table a second time and is the guard against a
 * post-signature special case creeping back in.
 */
describe('actionGate — sending', () => {
  it('allows a send when the job is accepted, unchanged, and the draft is complete', async () => {
    const { service } = makeHarness();
    const gate = await service.actionGate(SOW_ID);

    expect(gate).toMatchObject({ canSend: true, sendBlockers: [] });
  });

  it('blocks a job that was never accepted', async () => {
    const { service } = makeHarness({ job: { state: JobState.SUBMITTED, acceptedBillingFingerprint: undefined } });

    expect((await service.actionGate(SOW_ID)).sendBlockers).toEqual([DocumentBlocker.NOT_ACCEPTED]);
  });

  it('blocks a job accepted before acceptance was recorded, so one re-accept unlocks it', async () => {
    const { service } = makeHarness({ job: { state: JobState.ACCEPTED, acceptedBillingFingerprint: undefined } });

    expect((await service.actionGate(SOW_ID)).sendBlockers).toEqual([DocumentBlocker.NOT_ACCEPTED]);
  });

  it('re-locks when current job billing moved after it was accepted', async () => {
    const { service } = makeHarness({ liveFingerprint: 'fp-after-edit' });

    expect((await service.actionGate(SOW_ID)).sendBlockers).toEqual([DocumentBlocker.DOCUMENT_STALE]);
  });

  it('blocks a document whose figures lag the billing core', async () => {
    const { service, sow } = makeHarness();
    sow.documentStale = true;

    expect((await service.actionGate(SOW_ID)).sendBlockers).toEqual([DocumentBlocker.DOCUMENT_STALE]);
  });

  it('blocks a draft missing a required section', async () => {
    const { service } = makeHarness({
      fields: [{ key: 'billToAddress', label: 'Bill To Address', kind: SowFieldKind.PROSE, order: 110, value: 'x', isOverridden: false, isEnabled: true, allowsTextOverride: true }]
    });
    const gate = await service.actionGate(SOW_ID);

    expect(gate.sendBlockers).toEqual([DocumentBlocker.DRAFT_INCOMPLETE]);
    expect(gate.missingFields).toContain('Engagement Resources');
  });

  it('reports blockers in the order staff should resolve them', async () => {
    const { service, sow } = makeHarness({
      job: { state: JobState.SUBMITTED, acceptedBillingFingerprint: undefined },
      fields: [{ key: 'billToAddress', label: 'Bill To Address', kind: SowFieldKind.PROSE, order: 110, value: 'x', isOverridden: false, isEnabled: true, allowsTextOverride: true }]
    });
    sow.documentStale = true;

    expect((await service.actionGate(SOW_ID)).sendBlockers).toEqual([DocumentBlocker.NOT_ACCEPTED, DocumentBlocker.DOCUMENT_STALE, DocumentBlocker.DRAFT_INCOMPLETE]);
  });

  it('does not treat a saved staff adjustment as a job-contract change', async () => {
    const { service, sow, versions } = makeHarness();
    // An adjustment moves the document's total but not the job's spec, so the
    // acceptance still covers what the customer agreed to. Mirror it into the
    // version because an unsaved adjustment must still trip DOCUMENT_STALE.
    sow.pricing = { baseCost: 0, adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 50 }], totalCost: -50 };
    versions[0].inputs.adjustments = [{ type: 'DISCOUNT', description: 'Academic', amount: 50 }];
    versions[0].inputs.totalCost = -50;

    expect(await service.actionGate(SOW_ID)).toMatchObject({ canSend: true, sendBlockers: [] });
  });

  it('never reports both acceptance blockers at once — a job that was never accepted cannot also have drifted', async () => {
    const { service } = makeHarness({ job: { state: JobState.SUBMITTED, acceptedBillingFingerprint: undefined }, liveFingerprint: 'fp-after-edit' });

    expect((await service.actionGate(SOW_ID)).sendBlockers).toEqual([DocumentBlocker.NOT_ACCEPTED]);
  });

  describe('sendToCustomer enforces the gate rather than trusting the resolved field', () => {
    it('refuses to send an unaccepted job', async () => {
      const { service } = makeHarness({ job: { state: JobState.SUBMITTED, acceptedBillingFingerprint: undefined } });

      await expect(service.sendToCustomer(SOW_ID, staff)).rejects.toThrow(BadRequestException);
    });

    it('refuses to send after billing changed, and sends once the accepted billing stamp catches up', async () => {
      const { service, job } = makeHarness({ liveFingerprint: 'fp-after-edit' });
      await expect(service.sendToCustomer(SOW_ID, staff)).rejects.toThrow(/Recalculate/);

      // Re-accepting is exactly re-stamping the fingerprint with the current one.
      job.acceptedBillingFingerprint = 'fp-after-edit';
      const sent = await service.sendToCustomer(SOW_ID, staff);

      expect(sent.status).toBe(SOWStatus.SENT);
    });

    it('refuses to send a document whose figures lag the job', async () => {
      const { service, sow } = makeHarness();
      sow.documentStale = true;

      await expect(service.sendToCustomer(SOW_ID, staff)).rejects.toThrow(/Recalculate the Fee Schedule/);
    });
  });

  /**
   * Signing is not a lifecycle branch.
   *
   * What must not differ is the *spec* half of the rule — accepted, unchanged
   * since, document matching the job. Those blockers appear identically whether
   * the current version is a draft or already signed. (A signed current version
   * separately reports NO_DRAFT_TO_SEND, because there is no draft to issue
   * until someone edits it — that is a fact about the document, not a rule about
   * signatures.)
   */
  describe('the spec rule does not change once a SOW has been signed', () => {
    const specBlockers = (list: DocumentBlocker[]): DocumentBlocker[] => list.filter((b) => b !== DocumentBlocker.NO_DRAFT_TO_SEND && b !== DocumentBlocker.DRAFT_INCOMPLETE);

    const cases: Array<{ name: string; opts: any; expected: DocumentBlocker[] }> = [
      { name: 'nothing wrong', opts: {}, expected: [] },
      { name: 'never accepted', opts: { job: { state: JobState.SUBMITTED, acceptedBillingFingerprint: undefined } }, expected: [DocumentBlocker.NOT_ACCEPTED] },
      { name: 'job billing changed since acceptance', opts: { liveFingerprint: 'fp-after-edit' }, expected: [DocumentBlocker.DOCUMENT_STALE] }
    ];

    it.each(cases)('reports the same spec blockers on a draft and on a signed version: $name', async ({ opts, expected }) => {
      const draft = makeHarness(opts);
      const signed = makeHarness({ ...opts, status: SOWStatus.SIGNED });

      expect(specBlockers((await draft.service.actionGate(SOW_ID)).sendBlockers)).toEqual(expected);
      expect(specBlockers((await signed.service.actionGate(SOW_ID)).sendBlockers)).toEqual(expected);
    });

    it('reports a stale document identically either way', async () => {
      const draft = makeHarness();
      const signed = makeHarness({ status: SOWStatus.SIGNED });
      draft.sow.documentStale = true;
      signed.sow.documentStale = true;

      expect(specBlockers((await draft.service.actionGate(SOW_ID)).sendBlockers)).toEqual([DocumentBlocker.DOCUMENT_STALE]);
      expect(specBlockers((await signed.service.actionGate(SOW_ID)).sendBlockers)).toEqual([DocumentBlocker.DOCUMENT_STALE]);
    });

    it('reports NO_DRAFT_TO_SEND for an already-issued version, agreeing with sendToCustomer', async () => {
      const { service } = makeHarness({ status: SOWStatus.SIGNED });
      const gate = await service.actionGate(SOW_ID);

      expect(gate.canSend).toBe(false);
      expect(gate.sendBlockers).toEqual([DocumentBlocker.NO_DRAFT_TO_SEND]);
      await expect(service.sendToCustomer(SOW_ID, staff)).rejects.toThrow();
    });
  });
});

describe('actionGate — countersigning', () => {
  const signedHarness = (extra: any = {}): ReturnType<typeof makeHarness> => {
    const h = makeHarness(extra);
    h.versions[0].status = SOWStatus.SIGNED;
    h.versions[0].visibleToCustomer = true;
    h.sow.activeVersionNumber = 1;
    h.sow.currentVersionNumber = 1;
    h.sow.status = SOWStatus.SIGNED;
    return h;
  };

  it('allows a countersignature on the signed version in force', async () => {
    const { service } = signedHarness();
    const gate = await service.actionGate(SOW_ID);

    expect(gate).toMatchObject({ canCountersign: true, countersignBlockers: [] });
  });

  it('blocks it while the customer has not signed yet', async () => {
    const { service, sow, versions } = signedHarness();
    versions[0].status = SOWStatus.SENT;
    sow.activeVersionNumber = 1;

    expect((await service.actionGate(SOW_ID)).countersignBlockers).toEqual([DocumentBlocker.AWAITING_CUSTOMER_SIGNATURE]);
  });

  it('blocks countersignature with UNSENT_DRAFT when a draft sits above the signed version', async () => {
    const { service, sow } = signedHarness();
    sow.currentVersionNumber = 2;

    expect((await service.actionGate(SOW_ID)).countersignBlockers).toEqual([DocumentBlocker.UNSENT_DRAFT]);
    expect((await service.actionGate(SOW_ID)).canCountersign).toBe(false);
  });

  it('blocks it when the document no longer matches the job', async () => {
    const { service, sow } = signedHarness();
    sow.documentStale = true;

    expect((await service.actionGate(SOW_ID)).countersignBlockers).toEqual([DocumentBlocker.DOCUMENT_STALE]);
  });

  it('blocks it when job billing changed after it was accepted', async () => {
    const { service } = signedHarness({ liveFingerprint: 'fp-after-edit' });

    expect((await service.actionGate(SOW_ID)).countersignBlockers).toEqual([DocumentBlocker.DOCUMENT_STALE]);
  });

  describe('finalize enforces the gate rather than trusting the resolved field', () => {
    it('countersigns when nothing is in the way', async () => {
      const { service } = signedHarness();
      const v = await service.finalize(SOW_ID, 'Dr Staff', staff);

      expect(v.status).toBe(SOWStatus.FINAL);
      expect(v.staffSignature?.name).toBe('Dr Staff');
    });

    it('refuses to finalize while a draft sits above the signed version', async () => {
      const { service, sow } = signedHarness();
      sow.currentVersionNumber = 2;

      await expect(service.finalize(SOW_ID, 'Dr Staff', staff)).rejects.toThrow(/Revert to the signed version/);
    });

    it('refuses to finalize a document whose figures no longer match the job', async () => {
      const { service, sow } = signedHarness();
      sow.documentStale = true;

      await expect(service.finalize(SOW_ID, 'Dr Staff', staff)).rejects.toThrow(/Recalculate the Fee Schedule/);
    });

    it('still refuses a blank name before it even looks at the gate', async () => {
      const { service, sow } = signedHarness();
      sow.documentStale = true;

      await expect(service.finalize(SOW_ID, '   ', staff)).rejects.toThrow(/name is required/);
    });
  });

  /**
   * A countersigned document gets no exemption: a price-material job change means
   * it no longer describes the work, so it goes back through the same loop.
   */
  it('blocks a re-countersignature once a FINAL document has gone stale', async () => {
    const { service, sow, versions } = signedHarness();
    versions[0].status = SOWStatus.FINAL;
    sow.documentStale = true;

    const gate = await service.actionGate(SOW_ID);
    expect(gate.canCountersign).toBe(false);
    expect(gate.canSend).toBe(false);
  });
});

describe('optimistic lifecycle transitions', () => {
  const addConcurrentDraft = (sow: any, versions: FakeVersion[]): void => {
    const source = versions.filter((version) => !version.isDiscarded).sort((a, b) => b.versionNumber - a.versionNumber)[0];
    const versionNumber = source.versionNumber + 10;
    versions.push({
      ...source,
      _id: `concurrent-draft-${versionNumber}`,
      versionNumber,
      status: SOWStatus.DRAFT,
      visibleToCustomer: false,
      note: 'Concurrent staff save'
    });
    sow.currentVersionNumber = versionNumber;
  };

  it('compensates a send row when a concurrent save wins the parent pointer', async () => {
    const { service, sow, versions, activityEvents, race } = makeHarness();
    let stagedRowWasFailClosed = false;
    race.beforeSowCas = (): void => {
      const staged = versions.find((version) => version.status === SOWStatus.SENT);
      stagedRowWasFailClosed = staged?.visibleToCustomer === false && staged?.isStaged === true;
      addConcurrentDraft(sow, versions);
    };

    await expect(service.sendToCustomer(SOW_ID, staff)).rejects.toThrow(ConflictException);

    expect(stagedRowWasFailClosed).toBe(true);
    expect(versions.some((version) => version.status === SOWStatus.SENT)).toBe(false);
    expect(versions.find((version) => version.versionNumber === sow.currentVersionNumber)?.note).toBe('Concurrent staff save');
    expect(sow.activeVersionNumber).toBe(0);
    expect(activityEvents).toHaveLength(0);
  });

  it('compensates a signature row when a concurrent save moves currentVersionNumber', async () => {
    const { service, sow, versions, race } = makeHarness();
    const sent = await service.sendToCustomer(SOW_ID, staff);
    race.beforeSowCas = (): void => addConcurrentDraft(sow, versions);

    await expect(service.sign(SOW_ID, { versionNumber: sent.versionNumber, name: 'Jane', consentedGroups: fullConsent }, owner)).rejects.toThrow(ConflictException);

    expect(versions.some((version) => version.status === SOWStatus.SIGNED)).toBe(false);
    expect(sow.activeVersionNumber).toBe(sent.versionNumber);
  });

  it('compensates a finalize row when a concurrent save moves currentVersionNumber', async () => {
    const { service, sow, versions, race } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    const signed = await service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner);
    race.beforeSowCas = (): void => addConcurrentDraft(sow, versions);

    await expect(service.finalize(SOW_ID, 'Dr Staff', staff)).rejects.toThrow(ConflictException);

    expect(versions.some((version) => version.status === SOWStatus.FINAL)).toBe(false);
    expect(sow.activeVersionNumber).toBe(signed.versionNumber);
  });
});

describe('fail-closed staged-row lookups', () => {
  it('hides a staged sent row from every read until reconcile claims it', async () => {
    const { service, sow, versions, activityEvents, race } = makeHarness();
    race.failPromotion = true;

    await expect(service.sendToCustomer(SOW_ID, staff)).rejects.toThrow(/promotion failure/);

    const stagedNumber = sow.activeVersionNumber;
    const staged = versions.find((version) => version.versionNumber === stagedNumber);
    expect(staged).toMatchObject({ status: SOWStatus.SENT, visibleToCustomer: false, isStaged: true });

    // Fail closed: a half-written send is nothing anyone should be shown, and
    // no read may repair it.
    const [current, active, exact] = await Promise.all([service.getCurrentVersion(SOW_ID), service.getActiveVersion(SOW_ID), service.getVersion(SOW_ID, stagedNumber)]);
    expect([current, active, exact]).toEqual([null, null, null]);
    expect(activityEvents).toHaveLength(0);

    // The pointer already names this row, so its CAS did win — reconcile is
    // finishing a decision that was made, not making a new one.
    await service.reconcile(SOW_ID);

    for (const recovered of await Promise.all([service.getCurrentVersion(SOW_ID), service.getActiveVersion(SOW_ID), service.getVersion(SOW_ID, stagedNumber)])) {
      expect(recovered).toMatchObject({ versionNumber: stagedNumber, status: SOWStatus.SENT, visibleToCustomer: true, isStaged: false });
    }
    expect(activityEvents.filter((event) => event.type === 'SOW_SENT')).toHaveLength(1);
  });

  it('recovers a parent-claimed signed row on the next mutation without duplicating activity', async () => {
    const { service, sow, versions, activityEvents, race } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    race.failPromotion = true;

    await expect(service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner)).rejects.toThrow(/promotion failure/);
    const signedNumber = sow.activeVersionNumber;

    // Unclaimed, so invisible — and the retry is what repairs it.
    await expect(service.getActiveVersion(SOW_ID)).resolves.toBeNull();
    await expect(service.sign(SOW_ID, { versionNumber: signedNumber, name: 'Jane', consentedGroups: fullConsent }, owner)).rejects.toThrow();

    await expect(service.getActiveVersion(SOW_ID)).resolves.toMatchObject({
      versionNumber: signedNumber,
      status: SOWStatus.SIGNED,
      visibleToCustomer: true,
      isStaged: false
    });
    expect(versions.find((version) => version.versionNumber === signedNumber)?.isStaged).toBe(false);
    expect(activityEvents.filter((event) => event.type === 'SOW_SIGNED')).toHaveLength(1);
  });

  it('recovers a parent-claimed finalized row on a staff action gate with one activity', async () => {
    const { service, sow, versions, activityEvents, race } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    await service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner);
    race.failPromotion = true;

    await expect(service.finalize(SOW_ID, 'Dr Staff', staff)).rejects.toThrow(/promotion failure/);
    const finalNumber = sow.currentVersionNumber;

    await expect(service.getCurrentVersion(SOW_ID)).resolves.toBeNull();

    // Staff reads of the gate reconcile; customer reads never do.
    await service.actionGate(SOW_ID, undefined, { reconcile: true });

    await expect(service.getCurrentVersion(SOW_ID)).resolves.toMatchObject({
      versionNumber: finalNumber,
      status: SOWStatus.FINAL,
      visibleToCustomer: true,
      isStaged: false
    });
    expect(versions.find((version) => version.versionNumber === finalNumber)?.isStaged).toBe(false);
    expect(activityEvents.filter((event) => event.type === 'SOW_FINALIZED')).toHaveLength(1);
  });

  it('recovers a parent-claimed row through the original transition retry path', async () => {
    const { service, sow, versions, activityEvents, race } = makeHarness();
    race.failPromotion = true;

    await expect(service.sendToCustomer(SOW_ID, staff)).rejects.toThrow(/promotion failure/);
    const sentNumber = sow.currentVersionNumber;
    await expect(service.sendToCustomer(SOW_ID, staff)).rejects.toThrow(/Only a draft/);

    expect(versions.find((version) => version.versionNumber === sentNumber)).toMatchObject({ visibleToCustomer: true, isStaged: false });
    expect(activityEvents.filter((event) => event.type === 'SOW_SENT')).toHaveLength(1);
  });

  it('never delivers activity for an orphaned staged row, and keeps it out of history entirely', async () => {
    const { service, sow, versions, activityEvents, race } = makeHarness();
    race.beforeSowCas = (): void => {
      sow.currentVersionNumber = 99;
    };
    race.failCleanup = true;

    await expect(service.sendToCustomer(SOW_ID, staff)).rejects.toThrow(ConflictException);
    const staged = versions.find((version) => version.activityEventType === 'SOW_SENT');
    expect(staged).toMatchObject({ visibleToCustomer: false, isStaged: true });

    // Even the discarded-inclusive history excludes it: it is a write in
    // flight, not an abandoned draft, and no pointer names it.
    const history = await service.listVersions(SOW_ID, { includeDiscarded: true });
    expect(history).not.toContain(staged);

    // And reconcile must not adopt it either — the pointer was moved elsewhere.
    await service.reconcile(SOW_ID);
    expect(staged?.activityDeliveredAt).toBeUndefined();
    expect(activityEvents.filter((event) => event.type === 'SOW_SENT')).toHaveLength(0);
  });

  it('does not treat a non-customer-visible row as active', async () => {
    const { service, sow, versions } = makeHarness();
    versions[0].status = SOWStatus.SENT;
    versions[0].visibleToCustomer = false;
    sow.activeVersionNumber = versions[0].versionNumber;
    sow.status = SOWStatus.SENT;

    await expect(service.getActiveVersion(SOW_ID)).resolves.toBeNull();
  });
});

describe('stale sign-version gate', () => {
  it('refuses to sign a version that is not the one in force', async () => {
    const { service } = makeHarness();
    const sent = await service.sendToCustomer(SOW_ID, staff);

    expect((await service.actionGate(SOW_ID)).signBlockers).toEqual([]);
    const staleGate = await (service as any).actionGate(SOW_ID, sent.versionNumber - 1);
    expect(staleGate.canSign).toBe(false);
    expect(staleGate.signBlockers).toEqual([DocumentBlocker.STALE_SIGN_VERSION]);
  });
});

describe('structured adjustment drift at lifecycle gates', () => {
  const adjustment = {
    type: SOWAdjustmentType.ADDITIONAL_COST,
    description: 'Rush handling',
    category: 'DAYS',
    reason: 'Original reason',
    unitAmount: 10,
    multiplier: 2,
    amount: 20
  };

  const adjustmentHarness = (): ReturnType<typeof makeHarness> => {
    const harness = makeHarness();
    harness.sow.pricing = { baseCost: 0, adjustments: [{ ...adjustment }], totalCost: 20 };
    harness.versions[0].inputs.adjustments = [{ ...adjustment }];
    harness.versions[0].inputs.totalCost = 20;
    return harness;
  };

  it.each([
    ['reason', 'Changed reason'],
    ['unitAmount', 11],
    ['multiplier', 3]
  ])('%s drift blocks send, sign, and finalize', async (field, value) => {
    const send = adjustmentHarness();
    send.sow.pricing.adjustments[0][field] = value;
    await expect(send.service.sendToCustomer(SOW_ID, staff)).rejects.toThrow(/Recalculate/);

    const sign = adjustmentHarness();
    await sign.service.sendToCustomer(SOW_ID, staff);
    sign.sow.pricing.adjustments[0][field] = value;
    await expect(sign.service.sign(SOW_ID, { versionNumber: sign.sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner)).rejects.toThrow(/Recalculate/);

    const finalize = adjustmentHarness();
    await finalize.service.sendToCustomer(SOW_ID, staff);
    await finalize.service.sign(SOW_ID, { versionNumber: finalize.sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner);
    finalize.sow.pricing.adjustments[0][field] = value;
    await expect(finalize.service.finalize(SOW_ID, 'Dr Staff', staff)).rejects.toThrow(/Recalculate/);
  });
});

describe('shared contract-validity gate', () => {
  const materialRevision = (): any[] => [
    {
      ...acceptedWorkflows[0],
      nodes: [
        {
          ...acceptedWorkflows[0].nodes[0],
          formData: [{ id: 'volume', value: 99 }],
          // Price-neutral contract edits still require acceptance.
          price: acceptedWorkflows[0].nodes[0].price
        }
      ]
    }
  ];

  it('blocks send for a material price-neutral parameter edit after acceptance', async () => {
    const { service, jobVersions } = makeHarness();
    jobVersions.push({ versionNumber: 1001, authorRole: JobVersionAuthorRole.STAFF, workflows: materialRevision(), visibleToCustomer: false, isEvent: false });

    expect((await service.actionGate(SOW_ID)).sendBlockers).toEqual([DocumentBlocker.JOB_CHANGED_SINCE_ACCEPTANCE]);
    await expect(service.sendToCustomer(SOW_ID, staff)).rejects.toThrow(/Re-accept/);
  });

  it('blocks signing and leaves an invalidated SENT version visible and unchanged', async () => {
    const { service, sow, versions, jobVersions } = makeHarness();
    const sent = await service.sendToCustomer(SOW_ID, staff);
    jobVersions.push({ versionNumber: 1001, authorRole: JobVersionAuthorRole.STAFF, workflows: materialRevision(), visibleToCustomer: false, isEvent: false });

    const gate = await service.actionGate(SOW_ID);
    expect((gate as any).canSign).toBe(false);
    expect((gate as any).signBlockers).toEqual([DocumentBlocker.JOB_CHANGED_SINCE_ACCEPTANCE]);
    await expect(service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner)).rejects.toThrow(/Re-accept/);
    expect(versions.find((version) => version._id === sent._id)).toMatchObject({
      status: SOWStatus.SENT,
      visibleToCustomer: true,
      sourceJobVersionNumber: 1000
    });
  });

  it('blocks finalize for a material instruction edit after acceptance', async () => {
    const { service, sow, jobVersions } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    await service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner);
    const changed = [
      {
        ...acceptedWorkflows[0],
        nodes: [{ ...acceptedWorkflows[0].nodes[0], additionalInstructions: 'Use a different protocol' }]
      }
    ];
    jobVersions.push({ versionNumber: 1001, authorRole: JobVersionAuthorRole.STAFF, workflows: changed, visibleToCustomer: false, isEvent: false });

    expect((await service.actionGate(SOW_ID)).countersignBlockers).toEqual([DocumentBlocker.JOB_CHANGED_SINCE_ACCEPTANCE]);
    await expect(service.finalize(SOW_ID, 'Dr Staff', staff)).rejects.toThrow(/Re-accept/);
  });

  it('blocks signing for a price-neutral topology edit after acceptance', async () => {
    const { service, sow, jobVersions } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    const extraNode = { id: 'node-2', serviceId: 'service-2', formData: [], additionalInstructions: '', price: 0 };
    const changed = [
      {
        ...acceptedWorkflows[0],
        nodes: [...acceptedWorkflows[0].nodes, extraNode],
        edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }]
      }
    ];
    jobVersions.push({ versionNumber: 1001, authorRole: JobVersionAuthorRole.STAFF, workflows: changed, visibleToCustomer: false, isEvent: false });

    await expect(service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner)).rejects.toThrow(/Re-accept/);
  });

  // Any newer content version blocks, whatever it changed. The old fingerprint
  // could tell a layout-only edit from a contract one; a version number cannot.
  // That precision is no longer needed: under exclusive control no content
  // version can be written while the job is ACCEPTED, so reaching this state at
  // all means a write path escaped the gate — and failing closed is the right
  // answer to that.
  it('fails closed on any newer content version, even a layout-only one', async () => {
    const { service, jobVersions } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    jobVersions.push({
      versionNumber: 1001,
      authorRole: JobVersionAuthorRole.STAFF,
      visibleToCustomer: false,
      isEvent: false,
      workflows: [
        {
          ...acceptedWorkflows[0],
          nodes: [{ ...acceptedWorkflows[0].nodes[0], position: { x: 900, y: 800 }, state: 'IN_PROGRESS', assigneeId: 'staff-2' }]
        }
      ]
    });

    expect(((await service.actionGate(SOW_ID)) as any).signBlockers).toEqual([DocumentBlocker.JOB_CHANGED_SINCE_ACCEPTANCE]);
  });

  it('fails closed when the exact accepted source is missing or unpublished', async () => {
    const missing = makeHarness();
    missing.jobVersions.splice(0);
    expect((await missing.service.actionGate(SOW_ID)).sendBlockers).toEqual([acceptedSourceUnavailable]);

    const unpublished = makeHarness();
    unpublished.jobVersions[0].authorRole = JobVersionAuthorRole.STAFF;
    unpublished.jobVersions[0].visibleToCustomer = false;
    expect((await unpublished.service.actionGate(SOW_ID)).sendBlockers).toEqual([acceptedSourceUnavailable]);
  });

  // Job content is versioned and immutable, so "has it changed since acceptance?"
  // is a version-number comparison. Under exclusive control nothing can change
  // while a job is ACCEPTED, so this is defence-in-depth against a write path
  // that escaped the gate.
  it('fails closed when a newer content version exists than the one accepted', async () => {
    const { service, jobVersions } = makeHarness();
    jobVersions.push({ ...jobVersions[0], _id: 'newer', versionNumber: jobVersions[0].versionNumber + 1 });

    expect((await service.actionGate(SOW_ID)).sendBlockers).toEqual([DocumentBlocker.JOB_CHANGED_SINCE_ACCEPTANCE]);
  });

  it('fails closed for legacy jobs missing the new acceptance links', async () => {
    const { service } = makeHarness({ job: { acceptedJobVersionNumber: undefined } });

    expect((await service.actionGate(SOW_ID)).sendBlockers).toEqual([DocumentBlocker.NOT_ACCEPTED]);
  });

  it('checks all three independent fee-schedule staleness signals', async () => {
    const currentBillingMoved = makeHarness({ liveFingerprint: 'billing-now' });
    expect((await currentBillingMoved.service.actionGate(SOW_ID)).sendBlockers).toEqual([DocumentBlocker.DOCUMENT_STALE]);

    const documentInputsMoved = makeHarness();
    documentInputsMoved.versions[0].inputs.services = [{ serviceId: 'new-service', name: 'New', cost: 10 }];
    expect((await documentInputsMoved.service.actionGate(SOW_ID)).sendBlockers).toEqual([DocumentBlocker.DOCUMENT_STALE]);

    const staleFlag = makeHarness();
    staleFlag.sow.documentStale = true;
    expect((await staleFlag.service.actionGate(SOW_ID)).sendBlockers).toEqual([DocumentBlocker.DOCUMENT_STALE]);
  });

  it('enforces fee-schedule staleness at send, sign, and finalize', async () => {
    const send = makeHarness();
    send.sow.documentStale = true;
    await expect(send.service.sendToCustomer(SOW_ID, staff)).rejects.toThrow(/Recalculate/);

    const sign = makeHarness();
    await sign.service.sendToCustomer(SOW_ID, staff);
    sign.sow.documentStale = true;
    await expect(sign.service.sign(SOW_ID, { versionNumber: sign.sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner)).rejects.toThrow(/Recalculate/);

    const finalize = makeHarness();
    await finalize.service.sendToCustomer(SOW_ID, staff);
    await finalize.service.sign(SOW_ID, { versionNumber: finalize.sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner);
    finalize.sow.documentStale = true;
    await expect(finalize.service.finalize(SOW_ID, 'Dr Staff', staff)).rejects.toThrow(/Recalculate/);
  });

  it('preserves stale-tab protection before evaluating signature consent', async () => {
    const { service, sow } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);

    await expect(service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber - 1, name: 'Jane', consentedGroups: fullConsent }, owner)).rejects.toThrow(ConflictException);
  });

  it('does not rewrite signed or final historical records when the job later changes', async () => {
    const { service, sow, versions, jobVersions } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    const signed = await service.sign(SOW_ID, { versionNumber: sow.activeVersionNumber, name: 'Jane', consentedGroups: fullConsent }, owner);
    const final = await service.finalize(SOW_ID, 'Dr Staff', staff);
    const snapshots = [signed, final].map((version) => JSON.parse(JSON.stringify(version)));
    jobVersions.push({ versionNumber: 1001, authorRole: JobVersionAuthorRole.STAFF, workflows: materialRevision(), visibleToCustomer: false, isEvent: false });

    await service.actionGate(SOW_ID);

    expect(JSON.parse(JSON.stringify(versions.find((version) => version._id === signed._id)))).toEqual(snapshots[0]);
    expect(JSON.parse(JSON.stringify(versions.find((version) => version._id === final._id)))).toEqual(snapshots[1]);
  });
});

describe('cancelling a SOW', () => {
  // Cancelling is how a document is retired rather than taken back to edit —
  // including after the job's acceptance is withdrawn, where it would otherwise
  // be stranded: unsendable, unsignable, and with no way to dispose of it.
  it('cancels, tells the client, and still allows a replacement afterwards', async () => {
    const { service, sow, comments } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);

    const cancelled = await service.cancel(SOW_ID, 'Project is not going ahead on these terms.', staff);

    expect(cancelled.status).toBe(SOWStatus.CANCELLED);
    expect(sow.status).toBe(SOWStatus.CANCELLED);
    expect(comments.some((c) => c.content.includes('no longer in effect') && c.content.includes('not going ahead'))).toBe(true);

    // Replacement path: a cancelled document is editable again.
    const draft = await service.saveVersion(SOW_ID, saveInput(sow.currentVersionNumber, 'new terms'), staff);
    expect(draft.status).toBe(SOWStatus.DRAFT);
    const reissued = await service.sendToCustomer(SOW_ID, staff);
    expect(reissued.status).toBe(SOWStatus.SENT);
  });

  it('refuses to cancel twice', async () => {
    const { service } = makeHarness();
    await service.cancel(SOW_ID, undefined, staff);
    await expect(service.cancel(SOW_ID, undefined, staff)).rejects.toThrow(/already cancelled/);
  });

  it('addresses the client in the third person, since staff read the same thread', async () => {
    const { service, comments } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    await service.withdrawFromCustomer(SOW_ID, 'Reworking.', staff);

    expect(comments[0].content).toContain('sent to the client');
    expect(comments[0].content).not.toMatch(/\bsent to you\b/);
  });
});
