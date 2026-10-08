import { calculateServiceCost, calculateServiceCostBreakdown } from './service-pricing.util';

/** show-only-if rule 19: a hidden parameter is not priced, and a hidden multiplier multiplies nothing. */
const sampleIsBacteria = { parameterId: 'sample', op: 'eq', optionIds: ['bact'] };
const parameters = [
  {
    id: 'sample',
    name: 'Sample Type',
    type: 'dropdown',
    options: [
      { id: 'bact', name: 'Bacteria', price: 10 },
      { id: 'yeast', name: 'Yeast', price: 20 }
    ]
  },
  {
    id: 'lysis',
    name: 'Lysis',
    type: 'dropdown',
    showIf: sampleIsBacteria,
    options: [
      { id: 'enz', name: 'Enzymatic', price: 7 },
      { id: 'oth', name: 'Other', price: 9 }
    ]
  },
  { id: 'kit', name: 'Kit', type: 'string', price: 5, showIf: sampleIsBacteria },
  { id: 'hours', name: 'Hours', type: 'number', isPriceMultiplier: true, price: 40, showIf: sampleIsBacteria }
];
const parameterPriced: any = { name: 'Extraction', pricingMode: 'PARAMETER', parameters };
const servicePriced: any = {
  name: 'Extraction',
  pricingMode: 'SERVICE',
  price: 100,
  parameters: [parameters[0], { id: 'plates', name: 'Plates', type: 'number', isPriceMultiplier: true, showIf: sampleIsBacteria }]
};

const answers = (sample: string): any[] => [
  { id: 'sample', value: sample },
  { id: 'lysis', value: 'oth' },
  { id: 'lysis__otherText', value: 'Bead beating' },
  { id: 'kit', value: 'K-12' },
  { id: 'hours', value: 3 }
];

describe('pricing ignores hidden parameters (show-only-if rule 19)', () => {
  it('prices every answer while its condition holds', () => {
    const breakdown = calculateServiceCostBreakdown(parameterPriced, answers('bact'));
    expect(breakdown.cost).toBe(10 + 9 + 5 + 40 * 3);
    expect(breakdown.details?.map((d) => d.label)).toEqual(['Sample Type: Bacteria', 'Lysis: Other: Bead beating', 'Kit', 'Hours']);
  });

  it('prices no hidden option, parameter or priced multiplier, and lists none of them', () => {
    const breakdown = calculateServiceCostBreakdown(parameterPriced, answers('yeast'));
    expect(breakdown.cost).toBe(20);
    expect(breakdown.details).toEqual([{ label: 'Sample Type: Yeast', quantity: 1, unitPrice: 20, total: 20 }]);
  });

  it('a hidden price-multiplier parameter multiplies nothing', () => {
    const sent = (sample: string): any[] => [
      { id: 'sample', value: sample },
      { id: 'plates', value: 4 },
      { id: '__runCount', value: 2 }
    ];
    expect(calculateServiceCostBreakdown(servicePriced, sent('bact'))).toMatchObject({ unitCost: 100, multiplier: 8, cost: 800 });
    // The run count is a reserved entry: it still multiplies.
    expect(calculateServiceCostBreakdown(servicePriced, sent('yeast'))).toMatchObject({ unitCost: 100, multiplier: 2, cost: 200 });
  });

  it('a step whose only answers are hidden prices to zero, not to the stored fallback (Review Focus 2)', () => {
    const onlyHidden = [{ id: 'kit', value: 'K-12' }];
    expect(calculateServiceCost(parameterPriced, onlyHidden, 999)).toBe(0);
    expect(calculateServiceCostBreakdown(parameterPriced, onlyHidden, undefined, undefined, { fallbackLineCost: 999 }).cost).toBe(0);
    // With no answers at all the fallback still applies, as before.
    expect(calculateServiceCost(parameterPriced, [], 999)).toBe(999);
  });

  it('reads the legacy object-keyed formData shape too', () => {
    expect(calculateServiceCost(parameterPriced, { sample: 'yeast', kit: 'K-12', hours: 3 })).toBe(20);
  });

  it('prices a parameter whose condition no longer resolves: it is shown (rule 13)', () => {
    const orphan: any = { name: 'X', pricingMode: 'PARAMETER', parameters: [{ id: 'kit', name: 'Kit', type: 'string', price: 5, showIf: { parameterId: 'deleted', op: 'eq', value: 'x' } }] };
    expect(calculateServiceCost(orphan, [{ id: 'kit', value: 'K-12' }])).toBe(5);
  });
});
