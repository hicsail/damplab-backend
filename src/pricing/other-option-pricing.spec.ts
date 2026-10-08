import { calculateServiceCostBreakdown } from './service-pricing.util';

const service: any = {
  name: 'Extraction',
  pricingMode: 'PARAMETER',
  parameters: [
    {
      id: 'sample_type',
      name: 'Sample Type',
      type: 'dropdown',
      options: [
        { id: 'bact', name: 'Bacteria', price: 10 },
        { id: 'oth', name: 'Other', price: 25 }
      ]
    }
  ]
};

describe('pricing and the "Other" companion entry', () => {
  it('labels the priced selection "Other: <text>" (what the SOW fee schedule and the invoice print)', () => {
    const breakdown = calculateServiceCostBreakdown(service, [
      { id: 'sample_type', value: 'oth' },
      { id: 'sample_type__otherText', value: 'Yeast' }
    ]);
    expect(breakdown.details).toEqual([{ label: 'Sample Type: Other: Yeast', quantity: 1, unitPrice: 25, total: 25 }]);
  });

  it('charges the same with and without the companion entry', () => {
    const without = calculateServiceCostBreakdown(service, [{ id: 'sample_type', value: 'oth' }]);
    const withText = calculateServiceCostBreakdown(service, [
      { id: 'sample_type', value: 'oth' },
      { id: 'sample_type__otherText', value: 'Yeast' }
    ]);
    expect(withText.cost).toBe(without.cost);
    expect(without.details?.[0].label).toBe('Sample Type: Other');
  });
});
