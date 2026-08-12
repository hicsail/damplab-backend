import { BadRequestException, ConflictException } from '@nestjs/common';
import mongoose from 'mongoose';
import { SowVersionService } from './sow-version.service';
import { SowFieldKind } from './sow-version.model';
import { SOWStatus } from './sow.model';
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

function makeHarness(initial: { status?: SOWStatus; fields?: any[] } = {}): { service: SowVersionService; sow: any; versions: FakeVersion[] } {
  const versions: FakeVersion[] = [
    {
      _id: 'v1',
      sowId: SOW_ID,
      versionNumber: 1,
      fields: initial.fields ?? [
        { key: 'billToAddress', label: 'Bill To Address', kind: SowFieldKind.PROSE, order: 110, value: 'x', isOverridden: false, isEnabled: true, allowsTextOverride: true },
        { key: 'feeSchedule', label: 'Fee Schedule', kind: SowFieldKind.CALCULATED, order: 100, value: 'Total: $0.00', isOverridden: false, isEnabled: true, allowsTextOverride: false }
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
    deliverables: [],
    questions: []
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
        if (u.$push?.questions) sow.questions.push(u.$push.questions);
        return sow;
      }
    })
  };

  const sowService: any = {
    applyDocumentBilling: async () => sow,
    getJobForSow: async () => ({ customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC', jobId: '04217', sub: 'sub-owner', email: 'client@lab.org' })
  };

  return { service: new SowVersionService(versionModel, sowModel, sowService), sow, versions };
}

const staff = { sub: 'sub-staff', name: 'tech' };
const owner = { sub: 'sub-owner', email: 'client@lab.org', preferred_username: 'jane', realm_access: { roles: [] } } as User;

const saveInput = (base: number, note?: string): any => ({
  baseVersionNumber: base,
  note,
  fields: [{ key: 'billToAddress', value: 'edited', isEnabled: true }],
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
        { key: 'custom-1', kind: SowFieldKind.CUSTOM, order: 1000, value: 'hidden', isEnabled: false, allowsTextOverride: true, label: 'c', isOverridden: false }
      ]
    });
    await h.service.sendToCustomer(SOW_ID, staff);
    const v = await h.service.sign(SOW_ID, { versionNumber: h.sow.activeVersionNumber, name: 'Jane', consentedGroups: [SowFieldKind.PROSE] }, owner);
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
    await service.sendToCustomer(SOW_ID, staff); // v2 SENT, active=2
    const draft = await service.saveVersion(SOW_ID, saveInput(2), staff); // v3 DRAFT

    await service.discardDraft(SOW_ID, draft.versionNumber);
    expect(sow.currentVersionNumber).toBe(2);
    expect(sow.activeVersionNumber).toBe(2);
  });

  it('refuses to discard a version the customer has seen', async () => {
    const { service, sow } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    await expect(service.discardDraft(SOW_ID, sow.activeVersionNumber)).rejects.toThrow(BadRequestException);
  });

  it('refuses to discard the only version, which would leave the SOW with no document', async () => {
    const { service } = makeHarness();
    await expect(service.discardDraft(SOW_ID, 1)).rejects.toThrow(/only version/i);
  });

  it('does not reopen the editor on the draft that was just discarded', async () => {
    const { service } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff); // v2 SENT
    const draft = await service.saveVersion(SOW_ID, saveInput(2), staff); // v3 DRAFT
    await service.discardDraft(SOW_ID, draft.versionNumber);

    const current = await service.getCurrentVersion(SOW_ID);
    expect(current?.versionNumber).toBe(2);
    expect(current?.status).toBe(SOWStatus.SENT);
  });

  it('does not reuse the discarded number, which would collide on the unique index', async () => {
    const { service } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff); // v2
    const draft = await service.saveVersion(SOW_ID, saveInput(2), staff); // v3
    await service.discardDraft(SOW_ID, draft.versionNumber);

    const next = await service.saveVersion(SOW_ID, saveInput(2), staff);
    expect(next.versionNumber).toBe(4);
  });
});

describe('questions', () => {
  it('appends to the thread tagged with the version in force', async () => {
    const { service, sow } = makeHarness();
    await service.sendToCustomer(SOW_ID, staff);
    await service.addQuestion(SOW_ID, '  Does the price include the QC rerun?  ', { sub: 'sub-owner', name: 'Jane', isStaff: false });

    expect(sow.questions).toHaveLength(1);
    expect(sow.questions[0].text).toBe('Does the price include the QC rerun?');
    expect(sow.questions[0].isStaff).toBe(false);
    expect(sow.questions[0].versionNumber).toBe(sow.activeVersionNumber);
  });

  it('rejects an empty question', async () => {
    const { service } = makeHarness();
    await expect(service.addQuestion(SOW_ID, '   ', { sub: 'x', name: 'x', isStaff: true })).rejects.toThrow(BadRequestException);
  });
});
