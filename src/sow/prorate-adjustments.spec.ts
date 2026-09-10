import { appliedAdjustmentsTotal, prorateAdjustments, prorationFactorFor } from './prorate-adjustments';

describe('prorationFactorFor', () => {
  it('is the billed share of the SOW base', () => {
    expect(prorationFactorFor(250, 1000)).toBe(0.25);
  });

  it('is 0 when the SOW bills nothing, rather than NaN', () => {
    expect(prorationFactorFor(100, 0)).toBe(0);
    expect(prorationFactorFor(0, 0)).toBe(0);
  });

  it('never exceeds 1, so an over-large share cannot over-credit a discount', () => {
    expect(prorationFactorFor(1200, 1000)).toBe(1);
  });
});

describe('prorateAdjustments', () => {
  const raw = [
    { type: 'DISCOUNT', description: 'Academic', reason: 'BU rate', amount: 100 },
    { type: 'ADDITIONAL_COST', description: 'Rush', amount: 50 },
    { type: 'SPECIAL_TERM', description: 'Data retained 12 months', amount: 0 }
  ];

  it('signs each type the way calculateAdjustmentsTotal does', () => {
    const [discount, extra, term] = prorateAdjustments(raw, 1);
    expect(discount.appliedAmount).toBe(-100);
    expect(extra.appliedAmount).toBe(50);
    expect(term.appliedAmount).toBe(0);
  });

  it('scales by the factor and rounds the applied amount to cents', () => {
    const [discount] = prorateAdjustments(raw, 0.3333);
    expect(discount.appliedAmount).toBe(-33.33);
  });

  it('keeps the whole-job amount alongside the applied one', () => {
    expect(prorateAdjustments(raw, 0.5)[0]).toMatchObject({ amount: 100, appliedAmount: -50 });
  });

  it('records the factor at four decimal places, not two', () => {
    // 0.5 and 0.997 must stay distinguishable from each other and from 1.
    expect(prorateAdjustments(raw, 0.99712)[0].prorationFactor).toBe(0.9971);
  });

  it('uses the stored amount, never a unitAmount x multiplier recomputation', () => {
    // buildFeeSchedule words a breakdown; an invoice bills the stored figure,
    // and switching would move totals on invoices already issued.
    expect(prorateAdjustments([{ type: 'DISCOUNT', description: 'D', amount: 60, unitAmount: 30, multiplier: 4 } as any], 1)[0].appliedAmount).toBe(-60);
  });

  it('leaves reason undefined rather than empty when the SOW carries none', () => {
    expect(prorateAdjustments([{ type: 'DISCOUNT', description: 'D', amount: 10 }], 1)[0].reason).toBeUndefined();
  });

  it('answers an empty list for absent adjustments', () => {
    expect(prorateAdjustments(null, 1)).toEqual([]);
  });
});

describe('appliedAdjustmentsTotal', () => {
  it('sums the applied amounts and rounds once', () => {
    // round2 is Math.round(n * 100) / 100, which rounds halves toward +Infinity:
    // -33.335 lands on -33.33, while +33.335 lands on 33.34. Pinned as-is —
    // "fixing" it to symmetric rounding would move figures on issued invoices.
    expect(appliedAdjustmentsTotal(prorateAdjustments([{ type: 'DISCOUNT', description: 'D', amount: 33.335 }], 1))).toBe(-33.33);
    expect(appliedAdjustmentsTotal(prorateAdjustments([{ type: 'ADDITIONAL_COST', description: 'A', amount: 33.335 }], 1))).toBe(33.34);
  });
});
