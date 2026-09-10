import { buildStatementServiceLines } from './statement-lines';

const line = (over: any = {}): any => ({
  serviceId: 's1',
  name: 'PCR',
  description: 'Amplification',
  cost: 350,
  unitCost: 175,
  multiplier: 2,
  runCount: 2,
  category: 'molecular-biology',
  pricingDetails: [{ label: 'Instrument', quantity: 1, unitPrice: 175, total: 175 }],
  ...over
});
const charge = (over: any = {}): any => ({ serviceId: 's1', label: 'PCR', amount: 350, sourceIndex: 0, ...over });

describe('buildStatementServiceLines', () => {
  it('takes the pricing basis from the SOW line and the money from the charge', () => {
    const [row] = buildStatementServiceLines([charge()], [line()]);
    expect(row).toMatchObject({ serviceId: 's1', name: 'PCR', description: 'Amplification', cost: 350, unitCost: 175, multiplier: 2, runCount: 2, category: 'molecular-biology', sourceIndex: 0 });
    expect(row.pricingDetails).toHaveLength(1);
  });

  it('bills the amount the line was RELEASED at, not what the SOW says today', () => {
    // A re-countersigned SOW reprices position 0; the released charge is what
    // the customer was told, so the statement keeps saying it.
    const [row] = buildStatementServiceLines([charge({ amount: 350 })], [line({ cost: 900 })]);
    expect(row.cost).toBe(350);
  });

  it('orders by position, whatever order the charges arrive in', () => {
    const rows = buildStatementServiceLines([charge({ sourceIndex: 1, serviceId: 's2', label: 'Gel', amount: 120 }), charge()], [line(), line({ serviceId: 's2', name: 'Gel', cost: 120 })]);
    expect(rows.map((r) => r.serviceId)).toEqual(['s1', 's2']);
  });

  it('still bills a line whose position is gone from the SOW, with what the charge knows', () => {
    const [row] = buildStatementServiceLines([charge({ sourceIndex: 7, label: 'Retired assay', amount: 90 })], [line()]);
    expect(row).toMatchObject({ serviceId: 's1', name: 'Retired assay', description: '', cost: 90, category: '', sourceIndex: 7 });
    expect(row.unitCost).toBeUndefined();
  });

  it('ignores the SOW line at that position when it is a different service now', () => {
    const [row] = buildStatementServiceLines([charge({ serviceId: 's1', amount: 350 })], [line({ serviceId: 's9', name: 'Something else', cost: 999 })]);
    expect(row.name).toBe('PCR');
    expect(row.cost).toBe(350);
    expect(row.unitCost).toBeUndefined();
  });

  it('leaves an absent breakdown undefined rather than inventing a zero', () => {
    const [row] = buildStatementServiceLines([charge()], [line({ unitCost: undefined, multiplier: undefined, runCount: undefined, pricingDetails: [] })]);
    expect(row.unitCost).toBeUndefined();
    expect(row.pricingDetails).toBeUndefined();
  });

  it('answers an empty list when nothing has been released', () => {
    expect(buildStatementServiceLines([], [line()])).toEqual([]);
  });
});
