import { SowVersionService } from './sow-version.service';
import { SOW, SOWAdjustmentType } from './sow.model';

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
