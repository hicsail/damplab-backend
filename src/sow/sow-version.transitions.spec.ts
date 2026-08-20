import { BadRequestException, ConflictException } from '@nestjs/common';
import mongoose from 'mongoose';
import { SowVersionService } from './sow-version.service';
import { SowFieldKind } from './sow-version.model';
import { SOWStatus, DocumentBlocker } from './sow.model';
import { JobState } from '../job/job.model';
import { User } from '../auth/user.interface';

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
  clientSignature?: any;
  staffSignature?: any;
  sentToCustomerAt?: Date;
  note?: string;
  createdBy: string;
  createdByName: string;
  createdAt: Date;
}

function matches(doc: any, query: Record<string, any>): boolean {
  return Object.entries(query).every(([k, v]) => String(doc[k]) === String(v));
}

function makeHarness(initial: { status?: SOWStatus; fields?: any[]; job?: any; liveFingerprint?: string } = {}): { service: SowVersionService; sow: any; versions: FakeVersion[]; job: any } {
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
      inputs: { services: [], adjustments: [], baseCost: 0, totalCost: 0, periods: [], scopeOfWork: [], deliverables: [], projectManager: '', projectLead: '' },
      status: initial.status ?? SOWStatus.DRAFT,
      visibleToCustomer: false,
      isDiscarded: false,
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
      }
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
        const target = versions.find((v) => matches(v, q));
        if (target) Object.assign(target, u.$set ?? {});
      }
    })
  };

  const sowModel: any = {
    findById: (): any => ({ exec: async (): Promise<any> => sow }),
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
    acceptedBillingFingerprint: 'fp-accepted',
    ...(initial.job ?? {})
  };

  const sowService: any = {
    applyDocumentBilling: async () => sow,
    getJobForSow: async () => job,
    jobBillingFingerprint: async () => initial.liveFingerprint ?? 'fp-accepted',
    autoAssignProjectLead: async () => undefined
  };

  // No blocks: prose falls back to SOW_PROSE_DEFAULTS, which is what these
  // transition tests assert against.
  const presetService: any = { defaultTextByKey: async () => ({}) };

  return { service: new SowVersionService(versionModel, sowModel, sowService, presetService), sow, versions, job };
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

describe('saveVersion', () => {
  it('appends a draft and advances the staff pointer only', async () => {
    const { service, sow } = makeHarness();
    const v = await service.saveVersion(SOW_ID, saveInput(1, 'first pass'), staff);

    expect(v.versionNumber).toBe(2);
    expect(v.status).toBe(SOWStatus.DRAFT);
    expect(v.visibleToCustomer).toBe(false);
    expect(sow.currentVersionNumber).toBe(2);
    expect(sow.activeVersionNumber).toBe(0);
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

  it('leaves the finalized version in force when staff start a new draft', async () => {
    const { service, sow } = await finalized();
    const finalNumber = sow.activeVersionNumber;

    const draft = await service.saveVersion(SOW_ID, saveInput(sow.currentVersionNumber, 'proposed revision'), staff);

    expect(draft.status).toBe(SOWStatus.DRAFT);
    expect(sow.currentVersionNumber).toBe(draft.versionNumber);
    // The whole point of the two-pointer split: the customer is still bound by
    // the finalized version until someone deliberately sends the revision.
    expect(sow.activeVersionNumber).toBe(finalNumber);
  });
});

describe('discardDraft', () => {
  it('drops an unsent draft and rolls the staff pointer back', async () => {
    const { service, sow } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff); // v1.0 (1000) SENT, active=1000
    const draft = await service.saveVersion(SOW_ID, saveInput(1000), staff); // v1.1 (1001) DRAFT

    await service.discardDraft(SOW_ID, draft.versionNumber);
    expect(sow.currentVersionNumber).toBe(1000);
    expect(sow.activeVersionNumber).toBe(1000);
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
    const { service } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff); // v1.0 (1000) SENT
    const draft = await service.saveVersion(SOW_ID, saveInput(1000), staff); // v1.1 (1001) DRAFT
    await service.discardDraft(SOW_ID, draft.versionNumber);

    const current = await service.getCurrentVersion(SOW_ID);
    expect(current?.versionNumber).toBe(1000);
    expect(current?.status).toBe(SOWStatus.SENT);
  });

  it('does not reuse the discarded number, which would collide on the unique index', async () => {
    const { service } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff); // v1.0 (1000)
    const draft = await service.saveVersion(SOW_ID, saveInput(1000), staff); // v1.1 (1001)
    await service.discardDraft(SOW_ID, draft.versionNumber);

    const next = await service.saveVersion(SOW_ID, saveInput(1000), staff);
    // 1001 is still on the books (discarded, not deleted), so the next draft
    // must skip past it to 1.2 (1002) rather than reusing 1.1.
    expect(next.versionNumber).toBe(1002);
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

  it('re-locks when the job spec moved after it was accepted', async () => {
    const { service } = makeHarness({ liveFingerprint: 'fp-after-edit' });

    expect((await service.actionGate(SOW_ID)).sendBlockers).toEqual([DocumentBlocker.JOB_CHANGED_SINCE_ACCEPTANCE]);
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

  it('is not re-locked by a staff adjustment, which is the whole point of adjustments surviving decision #2', async () => {
    const { service, sow } = makeHarness();
    // An adjustment moves the document's total but not the job's spec, so the
    // acceptance still covers what the customer agreed to.
    sow.pricing = { baseCost: 0, adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 50 }], totalCost: -50 };

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

    it('refuses to send after the job changed, and sends once it is re-accepted', async () => {
      const { service, job } = makeHarness({ liveFingerprint: 'fp-after-edit' });
      await expect(service.sendToCustomer(SOW_ID, staff)).rejects.toThrow(/Re-accept/);

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
      { name: 'job changed since acceptance', opts: { liveFingerprint: 'fp-after-edit' }, expected: [DocumentBlocker.JOB_CHANGED_SINCE_ACCEPTANCE] }
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
    h.sow.activeVersionNumber = 1;
    h.sow.currentVersionNumber = 1;
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

  it('blocks it when staff have revised the document since the signature', async () => {
    const { service, sow } = signedHarness();
    sow.currentVersionNumber = 2; // an unsent draft sits above the signed version

    expect((await service.actionGate(SOW_ID)).countersignBlockers).toEqual([DocumentBlocker.UNSENT_DRAFT]);
  });

  it('blocks it when the document no longer matches the job', async () => {
    const { service, sow } = signedHarness();
    sow.documentStale = true;

    expect((await service.actionGate(SOW_ID)).countersignBlockers).toEqual([DocumentBlocker.DOCUMENT_STALE]);
  });

  it('blocks it when the job changed after it was accepted', async () => {
    const { service } = signedHarness({ liveFingerprint: 'fp-after-edit' });

    expect((await service.actionGate(SOW_ID)).countersignBlockers).toEqual([DocumentBlocker.JOB_CHANGED_SINCE_ACCEPTANCE]);
  });

  describe('finalize enforces the gate rather than trusting the resolved field', () => {
    it('countersigns when nothing is in the way', async () => {
      const { service } = signedHarness();
      const v = await service.finalize(SOW_ID, 'Dr Staff', staff);

      expect(v.status).toBe(SOWStatus.FINAL);
      expect(v.staffSignature?.name).toBe('Dr Staff');
    });

    it('refuses to finalize a version staff have already revised past', async () => {
      const { service, sow } = signedHarness();
      sow.currentVersionNumber = 2;

      await expect(service.finalize(SOW_ID, 'Dr Staff', staff)).rejects.toThrow(/newer draft/);
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
