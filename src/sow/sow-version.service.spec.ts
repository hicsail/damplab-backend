import { SowVersionService } from './sow-version.service';
import { DocumentBlocker, SOW, SOWAdjustmentType } from './sow.model';

function sow(overrides: Partial<SOW> = {}): SOW {
  return {
    sowNumber: 'SOW 001',
    date: new Date('2026-03-01T00:00:00Z'),
    jobId: 'job-1',
    jobName: 'Plasmid prep',
    clientName: 'Jane Rivera',
    clientEmail: 'jane@lab.org',
    clientInstitution: 'Example University',
    scopeOfWork: ['Run NGS'],
    deliverables: ['FASTQ'],
    services: [{ _id: 's1', serviceId: 's1', name: 'NGS', description: 'seq', cost: 350, category: 'molecular-biology' }],
    timeline: { startDate: new Date('2026-03-03T00:00:00Z'), endDate: new Date('2026-03-16T00:00:00Z'), duration: '14 days' },
    resources: { projectManager: 'Courtney Tretheway', projectLead: 'Kristen Sheldon' },
    pricing: { baseCost: 350, adjustments: [], totalCost: 350 },
    ...overrides
  } as unknown as SOW;
}

describe('parseDurationDays', () => {
  const p = SowVersionService.parseDurationDays;

  it('reads the day count out of the free text the old flow stored', () => {
    expect(p('14 days')).toBe(14);
    expect(p('1 day')).toBe(1);
    expect(p('7')).toBe(7);
  });

  it('converts weeks and months', () => {
    expect(p('5 weeks')).toBe(35);
    expect(p('2 months')).toBe(60);
  });

  it('accepts a number', () => {
    expect(p(21)).toBe(21);
  });

  it('falls back to zero on junk rather than NaN', () => {
    expect(p('soon')).toBe(0);
    expect(p(undefined)).toBe(0);
    expect(p(null)).toBe(0);
    expect(p('')).toBe(0);
  });
});

describe('deriveInputs', () => {
  it('turns the single stored timeline into one period', () => {
    const inputs = SowVersionService.deriveInputs(sow(), { customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC' });
    expect(inputs.periods).toHaveLength(1);
    expect(inputs.periods[0].durationDays).toBe(14);
    expect(inputs.periods[0].startDate.toISOString().slice(0, 10)).toBe('2026-03-03');
  });

  it('carries staff, scope, deliverables and pricing across', () => {
    const inputs = SowVersionService.deriveInputs(sow(), null);
    expect(inputs.projectManager).toBe('Courtney Tretheway');
    expect(inputs.scopeOfWork).toEqual(['Run NGS']);
    expect(inputs.services[0]).toMatchObject({ serviceId: 's1', name: 'NGS', cost: 350 });
    expect(inputs.baseCost).toBe(350);
  });

  it('drops SPECIAL_TERM adjustments, which never affected any total', () => {
    const withSpecial = sow({
      pricing: {
        baseCost: 350,
        totalCost: 350,
        adjustments: [
          { _id: 'a1', type: SOWAdjustmentType.SPECIAL_TERM, description: 'Materials returned in 30 days', amount: 75 },
          { _id: 'a2', type: SOWAdjustmentType.ADDITIONAL_COST, description: 'Rush', amount: 120 }
        ]
      }
    } as any);

    const inputs = SowVersionService.deriveInputs(withSpecial, null);
    expect(inputs.adjustments).toHaveLength(1);
    expect(inputs.adjustments[0].type).toBe(SOWAdjustmentType.ADDITIONAL_COST);
  });

  it('survives a SOW with missing optional structures', () => {
    const bare = { jobId: 'j', sowNumber: 'SOW 002' } as unknown as SOW;
    const inputs = SowVersionService.deriveInputs(bare, null);
    expect(inputs.periods).toEqual([]);
    expect(inputs.services).toEqual([]);
    expect(inputs.baseCost).toBe(0);
  });
});

describe('billingFingerprint', () => {
  const base = SowVersionService.deriveInputs(sow(), { customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC' });

  it('is stable for unchanged billing data', () => {
    const again = SowVersionService.deriveInputs(sow(), { customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC' });
    expect(SowVersionService.billingFingerprint(again)).toBe(SowVersionService.billingFingerprint(base));
  });

  it('changes when a service cost changes', () => {
    const changed = SowVersionService.deriveInputs(
      sow({ services: [{ _id: 's1', serviceId: 's1', name: 'NGS', description: 'seq', cost: 400, category: 'x' }], pricing: { baseCost: 400, adjustments: [], totalCost: 400 } } as any),
      { customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC' }
    );
    expect(SowVersionService.billingFingerprint(changed)).not.toBe(SowVersionService.billingFingerprint(base));
  });

  it('changes when a service is added', () => {
    const changed = SowVersionService.deriveInputs(
      sow({
        services: [
          { _id: 's1', serviceId: 's1', name: 'NGS', description: 'seq', cost: 350, category: 'x' },
          { _id: 's2', serviceId: 's2', name: 'PCR', description: '', cost: 20, category: 'x' }
        ],
        pricing: { baseCost: 370, adjustments: [], totalCost: 370 }
      } as any),
      { customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC' }
    );
    expect(SowVersionService.billingFingerprint(changed)).not.toBe(SowVersionService.billingFingerprint(base));
  });

  it('changes when the pricing category changes', () => {
    const changed = SowVersionService.deriveInputs(sow(), { customerCategory: 'INTERNAL_CUSTOMERS' });
    expect(SowVersionService.billingFingerprint(changed)).not.toBe(SowVersionService.billingFingerprint(base));
  });

  it.each([
    ['reason', { reason: 'Weekend processing' }],
    ['unit amount', { unitAmount: 25 }],
    ['multiplier', { multiplier: 4 }]
  ])('changes when adjustment %s changes without changing its computed amount', (_label, patch) => {
    const adjustment = {
      type: SOWAdjustmentType.ADDITIONAL_COST,
      description: 'Rush handling',
      category: 'DAYS',
      reason: 'Original reason',
      unitAmount: 10,
      multiplier: 2,
      amount: 20
    };
    const before = { ...base, adjustments: [adjustment], totalCost: base.totalCost + 20 };
    const after = { ...before, adjustments: [{ ...adjustment, ...patch }] };

    expect(SowVersionService.billingFingerprint(after as any)).not.toBe(SowVersionService.billingFingerprint(before as any));
  });

  it('ignores changes that do not affect the fee schedule', () => {
    const changed = SowVersionService.deriveInputs(sow({ resources: { projectManager: 'Someone Else', projectLead: 'X' } } as any), { customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC' });
    expect(SowVersionService.billingFingerprint(changed)).toBe(SowVersionService.billingFingerprint(base));
  });
});

describe('version number encoding', () => {
  it('encodes major/minor into a single number, ordered exactly like major.minor would be', () => {
    expect(SowVersionService.encodeVersionNumber(0, 1)).toBe(1);
    expect(SowVersionService.encodeVersionNumber(0, 2)).toBe(2);
    expect(SowVersionService.encodeVersionNumber(1, 0)).toBe(1000);
    expect(SowVersionService.encodeVersionNumber(1, 2)).toBe(1002);
    expect(SowVersionService.encodeVersionNumber(2, 0)).toBe(2000);

    const encoded = [
      SowVersionService.encodeVersionNumber(0, 1),
      SowVersionService.encodeVersionNumber(0, 2),
      SowVersionService.encodeVersionNumber(1, 0),
      SowVersionService.encodeVersionNumber(1, 2),
      SowVersionService.encodeVersionNumber(2, 0)
    ];
    expect([...encoded].sort((a, b) => a - b)).toEqual(encoded);
  });

  it('decodes back to the major/minor it was built from', () => {
    expect(SowVersionService.decodeVersionNumber(1)).toEqual({ major: 0, minor: 1 });
    expect(SowVersionService.decodeVersionNumber(1002)).toEqual({ major: 1, minor: 2 });
    expect(SowVersionService.decodeVersionNumber(2000)).toEqual({ major: 2, minor: 0 });
  });

  it('formats the human label as major.minor', () => {
    expect(SowVersionService.displayVersionLabel(1)).toBe('0.1');
    expect(SowVersionService.displayVersionLabel(1000)).toBe('1.0');
    expect(SowVersionService.displayVersionLabel(1002)).toBe('1.2');
  });
});

/**
 * The preview query is the third place a calculated value is produced, and the
 * one that fires every time the editor opens. SowEditorModal applies what it
 * returns to any section the staff member has not overridden by hand — so if it
 * answered with today's block, opening a draft would silently adopt an edited
 * block across the whole document, and the next save would stamp every one of
 * those sections "Edited" for a change nobody made.
 */
describe('previewCalculatedValues — prose blocks', () => {
  function harness(storedFields: Array<{ key: string; calculatedValue: string }>, blocks: Record<string, string>): SowVersionService {
    const stored = sow();
    (stored as any)._id = 'sow-1';
    (stored as any).currentVersionNumber = 1;

    const storedVersion = {
      versionNumber: 1,
      fields: storedFields.map((f) => ({ ...f, value: f.calculatedValue, isOverridden: false, isEnabled: true }))
    };
    const versionModel: any = {
      findOne: () => ({
        exec: async () => storedVersion,
        sort: () => ({ exec: async () => storedVersion })
      })
    };
    const sowModel: any = { findById: () => ({ exec: async () => stored }) };
    const sowService: any = { getJobForSow: async () => ({ customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC', jobId: '1234' }) };
    const presetService: any = { defaultTextByKey: async () => blocks };
    const activityService: any = { createEventIdempotent: async () => undefined };
    // Required now, rather than @Optional(): a missing wiring used to degrade
    // silently into "no accepted source", which blocked every SOW.
    const jobVersionService: any = { getContentVersion: async () => null, getLatestContentVersion: async () => null };

    const commentService: any = { createIdempotent: async () => undefined };

    const notificationDispatch: any = { dispatch: () => undefined };

    return new SowVersionService(versionModel, sowModel, sowService, presetService, activityService, jobVersionService, commentService, notificationDispatch);
  }

  const valueFor = (rows: Array<{ key: string; calculatedValue: string }>, key: string): string | undefined => rows.find((r) => r.key === key)?.calculatedValue;

  it('answers with the snapshot the SOW was generated from, not the edited block', async () => {
    const service = harness([{ key: 'invoiceProcedures', calculatedValue: 'Original wording.' }], { invoiceProcedures: 'Rewritten wording.' });

    const rows = await service.previewCalculatedValues('sow-1', {});

    expect(valueFor(rows, 'invoiceProcedures')).toBe('Original wording.');
  });

  it('uses the current block for a prose section the stored version has never had', async () => {
    const service = harness([], { invoiceProcedures: 'Fresh wording.' });

    const rows = await service.previewCalculatedValues('sow-1', {});

    expect(valueFor(rows, 'invoiceProcedures')).toBe('Fresh wording.');
  });

  it('keeps recomputing the calculated sections', async () => {
    const service = harness([{ key: 'engagementResources', calculatedValue: 'stale text' }], {});

    const rows = await service.previewCalculatedValues('sow-1', { projectManager: 'New Manager', projectLead: 'Kristen Sheldon' });

    expect(valueFor(rows, 'engagementResources')).toContain('New Manager');
    expect(valueFor(rows, 'feeSchedule')).toContain('$350.00');
  });
});

/**
 * The job-owned half of the billing core — what the accept-before-send gate
 * compares. Adjustments are excluded on purpose: staff author those on the
 * document and must be able to change them without re-opening the customer's
 * agreement to the spec.
 */
describe('jobBillingFingerprint', () => {
  const services = [{ serviceId: 's1', name: 'PCR', cost: 350, unitCost: 5, multiplier: 70 }];

  it('is stable for the same services and category', () => {
    expect(SowVersionService.jobBillingFingerprint(services, 'INTERNAL_CUSTOMERS')).toBe(SowVersionService.jobBillingFingerprint([{ ...services[0] }], 'INTERNAL_CUSTOMERS'));
  });

  it('moves when a unit price moves', () => {
    expect(SowVersionService.jobBillingFingerprint([{ ...services[0], unitCost: 6, cost: 420 }], 'INTERNAL_CUSTOMERS')).not.toBe(
      SowVersionService.jobBillingFingerprint(services, 'INTERNAL_CUSTOMERS')
    );
  });

  it('moves when the multiplier moves, even though the line total is unchanged', () => {
    expect(SowVersionService.jobBillingFingerprint([{ ...services[0], unitCost: 10, multiplier: 35 }], 'INTERNAL_CUSTOMERS')).not.toBe(
      SowVersionService.jobBillingFingerprint(services, 'INTERNAL_CUSTOMERS')
    );
  });

  it('moves when the pricing category moves', () => {
    expect(SowVersionService.jobBillingFingerprint(services, 'EXTERNAL_CUSTOMER_MARKET')).not.toBe(SowVersionService.jobBillingFingerprint(services, 'INTERNAL_CUSTOMERS'));
  });

  it('computes for a job with no service lines at all — acceptance routinely precedes the SOW', () => {
    expect(() => SowVersionService.jobBillingFingerprint(null, null)).not.toThrow();
    expect(SowVersionService.jobBillingFingerprint(null, null)).toBe(SowVersionService.jobBillingFingerprint([], null));
  });

  it('is not tripped by an adjustment, which billingFingerprint does notice', () => {
    const base = { services, adjustments: [], baseCost: 350, totalCost: 350, customerCategory: 'INTERNAL_CUSTOMERS' } as any;
    const withAdjustment = { ...base, adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 50 }], totalCost: 300 } as any;

    expect(SowVersionService.jobBillingFingerprint(withAdjustment.services, withAdjustment.customerCategory)).toBe(SowVersionService.jobBillingFingerprint(base.services, base.customerCategory));
    expect(SowVersionService.billingFingerprint(withAdjustment)).not.toBe(SowVersionService.billingFingerprint(base));
  });
});

/**
 * A SOW version is a static record. Its Fee Schedule figures carry forward
 * untouched — a staff member editing prose must not silently reprice the
 * document — and move only when staff explicitly refresh them.
 */
describe('feeScheduleInputs', () => {
  const live: any = {
    services: [{ serviceId: 's1', name: 'PCR', cost: 420, unitCost: 6, multiplier: 70 }],
    adjustments: [],
    customerCategory: 'EXTERNAL_CUSTOMER_MARKET'
  };
  const previous: any = {
    services: [{ serviceId: 's1', name: 'PCR', cost: 350, unitCost: 5, multiplier: 70 }],
    adjustments: [],
    customerCategory: 'INTERNAL_CUSTOMERS'
  };

  it('carries the previous version forward when staff did not refresh', () => {
    const out = SowVersionService.feeScheduleInputs(live, previous, false);

    expect(out.services).toEqual(previous.services);
    expect(out.customerCategory).toBe('INTERNAL_CUSTOMERS');
    expect(out.baseCost).toBe(350);
  });

  it('takes the job figures when staff refreshed', () => {
    const out = SowVersionService.feeScheduleInputs(live, previous, true);

    expect(out.services).toEqual(live.services);
    expect(out.customerCategory).toBe('EXTERNAL_CUSTOMER_MARKET');
    expect(out.baseCost).toBe(420);
  });

  it('takes the job figures for a first version, which has nothing to carry', () => {
    expect(SowVersionService.feeScheduleInputs(live, null, false).services).toEqual(live.services);
  });

  it('takes the job figures when the previous version has no lines — a migrated record, not a free job', () => {
    expect(SowVersionService.feeScheduleInputs(live, { ...previous, services: [] }, false).services).toEqual(live.services);
    expect(SowVersionService.feeScheduleInputs(live, { ...previous, services: undefined }, false).services).toEqual(live.services);
  });

  it('recomputes the total from the carried base and the document’s current adjustments', () => {
    const withDiscount = { ...live, adjustments: [{ type: 'DISCOUNT', amount: 50 }] } as any;
    const out = SowVersionService.feeScheduleInputs(withDiscount, previous, false);

    // Base is the carried-forward 350, not the job's 420; the discount is current.
    expect(out.baseCost).toBe(350);
    expect(out.totalCost).toBe(300);
  });

  it('leaves the carried figures alone when only an adjustment changed', () => {
    const before = SowVersionService.feeScheduleInputs(live, previous, false);
    const after = SowVersionService.feeScheduleInputs({ ...live, adjustments: [{ type: 'ADDITIONAL_COST', amount: 25 }] } as any, previous, false);

    expect(after.services).toEqual(before.services);
    expect(after.baseCost).toBe(before.baseCost);
    expect(after.totalCost).toBe(375);
  });
});

describe('contract lifecycle blocker guidance', () => {
  it.each([DocumentBlocker.ACCEPTED_SOURCE_UNAVAILABLE])('gives the complete fail-closed repair sequence for %s', (blocker) => {
    const message = SowVersionService.blockerMessage([blocker]);

    expect(message).toMatch(/Re-accept/i);
    expect(message).toMatch(/save a new SOW draft/i);
    expect(message).toMatch(/reissue/i);
  });

  it('reports the first blocker because blocker order is the repair order', () => {
    expect(SowVersionService.blockerMessage([DocumentBlocker.NOT_ACCEPTED, DocumentBlocker.DOCUMENT_STALE])).toMatch(/^Accept this job/);
  });

  it('tells staff to revert to the signed version when a draft sits above it', () => {
    expect(SowVersionService.blockerMessage([DocumentBlocker.UNSENT_DRAFT])).toMatch(/Revert to the signed version/);
  });
});
