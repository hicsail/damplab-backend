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
        { key: 'feeSchedule', label: 'Fee Schedule', kind: SowFieldKind.CALCULATED, order: 100, value: 'Total: $0.00', isOverridden: false, isEnabled: true, allowsTextOverride: false },
        // Required before send — see sow-field-defaults.ts's allowsEmpty.
        { key: 'engagementResources', label: 'Engagement Resources', kind: SowFieldKind.CALCULATED, order: 50, value: 'Jane Doe – Project Manager', isOverridden: false, isEnabled: true, allowsTextOverride: true, allowsEmpty: false }
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
        { key: 'engagementResources', kind: SowFieldKind.CALCULATED, order: 50, value: 'Jane Doe – Project Manager', isEnabled: true, allowsTextOverride: true, allowsEmpty: false, label: 'Engagement Resources', isOverridden: false },
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
        { key: 'engagementResources', kind: SowFieldKind.CALCULATED, order: 50, value: 'Jane Doe – Project Manager', isEnabled: true, allowsTextOverride: true, allowsEmpty: false, label: 'Engagement Resources', isOverridden: false }
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
        { key: 'engagementResources', kind: SowFieldKind.CALCULATED, order: 50, value: 'Jane Doe – Project Manager', isEnabled: true, allowsTextOverride: true, allowsEmpty: false, label: 'Engagement Resources', isOverridden: false }
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
  it('keeps each line at its own edited cost when the same service appears twice', async () => {
    const { service, sow } = makeHarness();
    sow.services = [
      { serviceId: 'pcr', name: 'PCR', description: '', cost: 350 }, // 70 runs
      { serviceId: 'pcr', name: 'PCR', description: '', cost: 5 } // 1 run
    ];

    const preview = await service.previewCalculatedValues(SOW_ID, {
      services: [
        { serviceId: 'pcr', name: 'PCR', description: '', cost: 350 },
        { serviceId: 'pcr', name: 'PCR', description: '', cost: 5 }
      ]
    } as any);

    const feeSchedule = preview.find((f) => f.key === 'feeSchedule')?.calculatedValue ?? '';
    // Both lines' costs must survive distinctly; a serviceId-keyed lookup would
    // have applied the first line's edit ($350) to both, showing $700 total
    // instead of $355 and losing the second line's true cost entirely.
    expect(feeSchedule).toContain('$350.00');
    expect(feeSchedule).toContain('$5.00');
    expect(feeSchedule).toContain('Total: $355.00');
  });
});
