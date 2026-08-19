import { buildCalculatedFields, calculateFieldValues, mergeCalculatedFields, normalizeIncomingFields, periodEndDate, totalDurationDays, SowDocumentContext } from './sow-field-calculator';
import { SowField, SowFieldKind, SowVersionInputs } from './sow-version.model';
import { SOW_FIELD_CATALOG, SOW_PROSE_DEFAULTS } from './sow-field-defaults';
import { SOWAdjustmentType } from './sow.model';

function inputs(overrides: Partial<SowVersionInputs> = {}): SowVersionInputs {
  return {
    projectManager: 'Courtney Tretheway',
    projectLead: 'Kristen Sheldon',
    periods: [{ startDate: new Date('2026-03-03T00:00:00Z'), durationDays: 14 }],
    sowTitle: '',
    scopeOfWork: ['Run NGS on 70 samples'],
    deliverables: ['FASTQ files'],
    services: [{ serviceId: 's1', name: 'Next-gen sequencing', description: '', cost: 350 }],
    adjustments: [],
    baseCost: 350,
    totalCost: 350,
    customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC',
    ...overrides
  } as SowVersionInputs;
}

const ctx: SowDocumentContext = {
  sowNumber: 'SOW 001',
  date: new Date('2026-03-01T00:00:00Z'),
  jobDisplayId: '1234',
  jobName: 'Plasmid prep',
  clientName: 'Jane Rivera',
  clientEmail: 'jane@lab.org',
  clientInstitution: 'Example University'
};

function fieldByKey(fields: SowField[], key: string): SowField {
  const f = fields.find((x) => x.key === key);
  if (!f) throw new Error(`no field ${key}`);
  return f;
}

describe('period helpers', () => {
  it('treats a 1-day period as starting and ending the same day', () => {
    const end = periodEndDate({ startDate: new Date('2026-03-03T00:00:00Z'), durationDays: 1 } as any);
    expect(end.toISOString().slice(0, 10)).toBe('2026-03-03');
  });

  it('computes the inclusive end of a multi-day period', () => {
    const end = periodEndDate({ startDate: new Date('2026-03-03T00:00:00Z'), durationDays: 14 } as any);
    expect(end.toISOString().slice(0, 10)).toBe('2026-03-16');
  });

  it('sums durations across periods', () => {
    expect(totalDurationDays([{ durationDays: 14 } as any, { durationDays: 7 } as any])).toBe(21);
  });
});

describe('buildCalculatedFields', () => {
  it('produces every catalogue field, in order', () => {
    const fields = buildCalculatedFields(inputs(), ctx);
    expect(fields).toHaveLength(SOW_FIELD_CATALOG.length);
    expect(fields.map((f) => f.order)).toEqual([...fields.map((f) => f.order)].sort((a, b) => a - b));
  });

  it('starts with nothing overridden and value equal to calculatedValue', () => {
    for (const f of buildCalculatedFields(inputs(), ctx)) {
      expect(f.isOverridden).toBe(false);
      expect(f.value).toBe(f.calculatedValue);
    }
  });

  it('marks Fee Schedule as not text-overridable, and everything else as overridable', () => {
    const fields = buildCalculatedFields(inputs(), ctx);
    expect(fieldByKey(fields, 'feeSchedule').allowsTextOverride).toBe(false);
    expect(fieldByKey(fields, 'clientResponsibilities').allowsTextOverride).toBe(true);
  });

  it('disables fields that generate no content rather than emitting a bare heading', () => {
    const fields = buildCalculatedFields(inputs(), ctx);
    // additionalInformation defaults to empty
    expect(fieldByKey(fields, 'additionalInformation').isEnabled).toBe(false);
    expect(fieldByKey(fields, 'clientResponsibilities').isEnabled).toBe(true);
  });

  it('carries the standard prose verbatim', () => {
    const fields = buildCalculatedFields(inputs(), ctx);
    expect(fieldByKey(fields, 'clientResponsibilities').value).toBe(SOW_PROSE_DEFAULTS.clientResponsibilities);
    expect(fieldByKey(fields, 'completionCriteria').value).toContain('2-business days');
  });
});

describe('period of performance text', () => {
  it('reads as one stretch for a single period', () => {
    const v = calculateFieldValues(inputs(), ctx).periodOfPerformance;
    expect(v).toContain('within 14 days');
    expect(v).toContain('March 3, 2026');
    expect(v).toContain('March 16, 2026');
    expect(v).not.toContain('- ');
  });

  it('lists each period and gives the true period of performance — earliest start to latest end, not summed durations', () => {
    const v = calculateFieldValues(
      inputs({
        periods: [
          { startDate: new Date('2026-03-03T00:00:00Z'), durationDays: 14, label: 'Phase 1' },
          { startDate: new Date('2026-06-01T00:00:00Z'), durationDays: 7, label: 'Phase 2' }
        ]
      }),
      ctx
    ).periodOfPerformance;
    expect(v).toContain('- Phase 1: 14 days, from March 3, 2026 through March 16, 2026');
    // 7 days from June 1 inclusive ends June 7, matching the 1-day case above.
    expect(v).toContain('- Phase 2: 7 days, from June 1, 2026 through June 7, 2026');
    // Summing the two periods' durations would say 21 days; the actual span from
    // the earliest start (March 3) to the latest end (June 7) is 97 days.
    expect(v).not.toContain('21 days');
    expect(v).toContain('The overall period of performance is estimated to be 97 days, from March 3, 2026 through June 7, 2026.');
  });

  it('takes the span from the earliest start to the latest end even when periods are given out of order', () => {
    const v = calculateFieldValues(
      inputs({
        periods: [
          { startDate: new Date('2026-06-01T00:00:00Z'), durationDays: 7, label: 'Phase 2' },
          { startDate: new Date('2026-03-03T00:00:00Z'), durationDays: 14, label: 'Phase 1' }
        ]
      }),
      ctx
    ).periodOfPerformance;
    expect(v).toContain('The overall period of performance is estimated to be 97 days, from March 3, 2026 through June 7, 2026.');
  });

  it('does not overcount overlapping periods as if they were sequential', () => {
    const v = calculateFieldValues(
      inputs({
        periods: [
          { startDate: new Date('2026-03-03T00:00:00Z'), durationDays: 14, label: 'Phase 1' },
          { startDate: new Date('2026-03-10T00:00:00Z'), durationDays: 14, label: 'Phase 2' }
        ]
      }),
      ctx
    ).periodOfPerformance;
    // Summed durations would claim 28 days; the two overlap, so the true span
    // (March 3 through March 23) is 21 days.
    expect(v).toContain('The overall period of performance is estimated to be 21 days, from March 3, 2026 through March 23, 2026.');
  });

  it('supports retroactive periods', () => {
    const v = calculateFieldValues(inputs({ periods: [{ startDate: new Date('2020-01-06T00:00:00Z'), durationDays: 5 } as any] }), ctx).periodOfPerformance;
    expect(v).toContain('January 6, 2020');
  });

  it('is empty when no periods are set, so the section switches off', () => {
    expect(calculateFieldValues(inputs({ periods: [] }), ctx).periodOfPerformance).toBe('');
  });
});

describe('fee schedule text', () => {
  it('lists services, the pricing category and the total', () => {
    const v = calculateFieldValues(inputs(), ctx).feeSchedule;
    expect(v).toContain('Pricing category: External (Academic)');
    expect(v).toContain('- Next-gen sequencing — $350.00');
    expect(v).toContain('Total: $350.00');
  });

  it('shows the base price and multiplier behind a multiplied line', () => {
    const v = calculateFieldValues(inputs({ services: [{ serviceId: 's1', name: 'Next-gen sequencing', description: '', cost: 350, unitCost: 5, multiplier: 70 }] }), ctx).feeSchedule;
    expect(v).toContain('- Next-gen sequencing — $5.00 x 70 = $350.00');
  });

  it('quotes one figure when nothing multiplies the line', () => {
    const v = calculateFieldValues(inputs({ services: [{ serviceId: 's1', name: 'Next-gen sequencing', description: '', cost: 350, unitCost: 350, multiplier: 1 }] }), ctx).feeSchedule;
    expect(v).toContain('- Next-gen sequencing — $350.00');
  });

  it('writes a fractional multiplier without a spurious .00', () => {
    const v = calculateFieldValues(inputs({ services: [{ serviceId: 's1', name: 'Next-gen sequencing', description: '', cost: 12.5, unitCost: 5, multiplier: 2.5 }] }), ctx).feeSchedule;
    expect(v).toContain('- Next-gen sequencing — $5.00 x 2.5 = $12.50');
  });

  /**
   * mergeCalculatedFields regenerates this text on every load, including on a
   * version that is already sent, signed or finalized — and Fee Schedule has no
   * text override to fall back on. A line stored before unit prices existed must
   * therefore render exactly as it always did, never with a base recovered by
   * dividing the total.
   */
  it('leaves a line stored before unit prices existed exactly as it was', () => {
    const v = calculateFieldValues(inputs({ services: [{ serviceId: 's1', name: 'Next-gen sequencing', description: '', cost: 350, runCount: 70 } as any] }), ctx).feeSchedule;
    expect(v).toContain('- Next-gen sequencing — $350.00');
    expect(v).not.toContain('x 70');
  });

  it('shows a discount as negative and an additional cost as positive', () => {
    const v = calculateFieldValues(
      inputs({
        adjustments: [
          { type: SOWAdjustmentType.DISCOUNT, description: 'Academic discount', amount: 47, reason: 'grant' },
          { type: SOWAdjustmentType.ADDITIONAL_COST, description: 'Rush handling', amount: 120 }
        ],
        totalCost: 423
      }),
      ctx
    ).feeSchedule;
    expect(v).toContain('- Academic discount — grant: -$47.00');
    expect(v).toContain('- Rush handling: $120.00');
    expect(v).toContain('Total: $423.00');
  });
});

describe('mergeCalculatedFields', () => {
  it('refreshes non-overridden text when inputs change', () => {
    const v1 = buildCalculatedFields(inputs(), ctx);
    const merged = mergeCalculatedFields(v1, inputs({ projectManager: 'New Manager' }), ctx);
    expect(fieldByKey(merged, 'engagementResources').value).toContain('New Manager');
  });

  it('keeps an override but refreshes calculatedValue underneath it', () => {
    const v1 = buildCalculatedFields(inputs(), ctx);
    const edited = v1.map((f) => (f.key === 'engagementResources' ? { ...f, value: 'Bespoke wording', isOverridden: true } : f));

    const merged = mergeCalculatedFields(edited, inputs({ projectManager: 'New Manager' }), ctx);
    const f = fieldByKey(merged, 'engagementResources');
    expect(f.value).toBe('Bespoke wording');
    expect(f.isOverridden).toBe(true);
    // revert must land on today's value, not the one from when the override was made
    expect(f.calculatedValue).toContain('New Manager');
  });

  it('preserves a disabled section rather than dropping it', () => {
    const v1 = buildCalculatedFields(inputs(), ctx);
    const edited = v1.map((f) => (f.key === 'billToAddress' ? { ...f, isEnabled: false } : f));
    const merged = mergeCalculatedFields(edited, inputs(), ctx);
    const f = fieldByKey(merged, 'billToAddress');
    expect(f.isEnabled).toBe(false);
    expect(f.value).not.toBe('');
  });

  it('carries custom fields through untouched and after the catalogue', () => {
    const v1 = buildCalculatedFields(inputs(), ctx);
    const withCustom = [
      ...v1,
      { key: 'custom-abc', label: 'Shipping', kind: SowFieldKind.CUSTOM, order: 1000, value: 'Dry ice', isOverridden: false, isEnabled: true, allowsTextOverride: true } as SowField
    ];

    const merged = mergeCalculatedFields(withCustom, inputs(), ctx);
    const custom = fieldByKey(merged, 'custom-abc');
    expect(custom.value).toBe('Dry ice');
    expect(merged[merged.length - 1].key).toBe('custom-abc');
  });

  it('stops honouring an override on a field that is no longer overridable', () => {
    // Fee Schedule carries billing figures; a stale override must not win.
    const v1 = buildCalculatedFields(inputs(), ctx);
    const tampered = v1.map((f) => (f.key === 'feeSchedule' ? { ...f, value: 'Total: $1.00', isOverridden: true, allowsTextOverride: true } : f));

    const merged = mergeCalculatedFields(tampered, inputs(), ctx);
    const fee = fieldByKey(merged, 'feeSchedule');
    expect(fee.isOverridden).toBe(false);
    expect(fee.value).toContain('Total: $350.00');
  });
});

describe('normalizeIncomingFields', () => {
  it('refuses a client-supplied text override on Fee Schedule', () => {
    const incoming = [
      { key: 'feeSchedule', label: 'Fee Schedule', kind: SowFieldKind.CALCULATED, order: 100, value: 'Total: $1.00', isOverridden: true, isEnabled: true, allowsTextOverride: true } as SowField
    ];

    const fee = fieldByKey(normalizeIncomingFields(incoming, inputs(), ctx), 'feeSchedule');
    expect(fee.isOverridden).toBe(false);
    expect(fee.value).toContain('Total: $350.00');
  });

  it('accepts an override on an ordinary prose field', () => {
    const incoming = [
      { key: 'clientResponsibilities', label: 'x', kind: SowFieldKind.PROSE, order: 0, value: 'Client ships on dry ice.', isOverridden: true, isEnabled: true, allowsTextOverride: true } as SowField
    ];

    const f = fieldByKey(normalizeIncomingFields(incoming, inputs(), ctx), 'clientResponsibilities');
    expect(f.value).toBe('Client ships on dry ice.');
    expect(f.isOverridden).toBe(true);
  });

  it('takes label, kind and order from the catalogue, not the request', () => {
    const incoming = [{ key: 'billToAddress', label: 'Hacked Heading', kind: SowFieldKind.CUSTOM, order: -5, value: 'x', isOverridden: true, isEnabled: true, allowsTextOverride: true } as SowField];

    const f = fieldByKey(normalizeIncomingFields(incoming, inputs(), ctx), 'billToAddress');
    expect(f.label).toBe('Bill To Address');
    expect(f.kind).toBe(SowFieldKind.PROSE);
    expect(f.order).toBe(110);
  });

  it('restores omitted catalogue fields as disabled instead of dropping them', () => {
    const out = normalizeIncomingFields([], inputs(), ctx);
    expect(out).toHaveLength(SOW_FIELD_CATALOG.length);
    expect(out.every((f) => !f.isEnabled)).toBe(true);
  });

  it('keeps custom fields and ignores unknown non-custom keys', () => {
    const incoming = [
      { key: 'custom-1', label: 'Shipping', kind: SowFieldKind.CUSTOM, order: 0, value: 'Dry ice', isOverridden: false, isEnabled: true, allowsTextOverride: true },
      { key: 'notARealField', label: 'x', kind: SowFieldKind.PROSE, order: 0, value: 'x', isOverridden: false, isEnabled: true, allowsTextOverride: true }
    ] as SowField[];

    const out = normalizeIncomingFields(incoming, inputs(), ctx);
    expect(out.find((f) => f.key === 'custom-1')?.value).toBe('Dry ice');
    expect(out.find((f) => f.key === 'notARealField')).toBeUndefined();
  });

  it('drops duplicate keys rather than emitting the section twice', () => {
    const dup = { key: 'billToAddress', label: 'x', kind: SowFieldKind.PROSE, order: 0, value: 'first', isOverridden: true, isEnabled: true, allowsTextOverride: true } as SowField;
    const out = normalizeIncomingFields([dup, { ...dup, value: 'second' }], inputs(), ctx);
    expect(out.filter((f) => f.key === 'billToAddress')).toHaveLength(1);
    expect(fieldByKey(out, 'billToAddress').value).toBe('first');
  });

  it('re-enables a required field once it goes from empty to populated', () => {
    // Version 1 had no PM/Lead: Engagement Resources generated nothing and was
    // hidden. Staff then pick a PM/Lead — the live preview refreshes the field's
    // text (as SowEditorModal's runPreview does) but nothing client-side flips
    // the checkbox, so it still arrives at Save marked hidden.
    const previousFields = buildCalculatedFields(inputs({ projectManager: '', projectLead: '' }), ctx);
    expect(fieldByKey(previousFields, 'engagementResources').isEnabled).toBe(false);

    const freshValues = calculateFieldValues(inputs(), ctx);
    const incoming = previousFields.map(
      (f) =>
        ({
          key: f.key,
          label: f.label,
          kind: f.kind,
          order: f.order,
          value: freshValues[f.key] ?? f.value,
          isOverridden: f.isOverridden,
          isEnabled: false,
          allowsTextOverride: f.allowsTextOverride
        } as SowField)
    );

    const out = normalizeIncomingFields(incoming, inputs(), ctx, previousFields);
    expect(fieldByKey(out, 'engagementResources').isEnabled).toBe(true);
    expect(fieldByKey(out, 'engagementResources').value).toContain('Courtney Tretheway');
  });

  it('does not resurrect a required field the staff deliberately hid after it already had content', () => {
    const previousFields = buildCalculatedFields(inputs(), ctx); // PM/Lead already set, so it has content
    expect(fieldByKey(previousFields, 'engagementResources').isEnabled).toBe(true);

    const incoming = previousFields.map(
      (f) =>
        ({
          key: f.key,
          label: f.label,
          kind: f.kind,
          order: f.order,
          value: f.value,
          isOverridden: f.isOverridden,
          isEnabled: f.key === 'engagementResources' ? false : f.isEnabled,
          allowsTextOverride: f.allowsTextOverride
        } as SowField)
    );

    const out = normalizeIncomingFields(incoming, inputs(), ctx, previousFields);
    expect(fieldByKey(out, 'engagementResources').isEnabled).toBe(false);
  });

  it('marks Engagement Resources as required and everything else as allowed to be empty', () => {
    const out = normalizeIncomingFields([], inputs(), ctx);
    expect(fieldByKey(out, 'engagementResources').allowsEmpty).toBe(false);
    expect(fieldByKey(out, 'clientResponsibilities').allowsEmpty).toBe(true);
  });
});
