import { auditMultiplierPricing } from './audit-multiplier-pricing';
import { RUN_COUNT_PARAM_ID } from './service-pricing.util';

/** Just enough of a Db to serve one `damplabservices` find. */
function db(services: unknown[]): any {
  return { collection: () => ({ find: () => ({ toArray: async (): Promise<unknown[]> => services }) }) };
}

describe('audit: which services a priced multiplier reprices', () => {
  it('flags a PARAMETER-mode service whose multiplier parameter carries a price', async () => {
    const report = await auditMultiplierPricing(
      db([
        {
          _id: 'svc-1',
          name: 'Equipment use',
          pricingMode: 'PARAMETER',
          parameters: [
            { id: 'instrument', name: 'Instrument', type: 'dropdown', options: [{ id: 'b', name: 'Bioanalyzer', price: 100 }] },
            { id: 'hours', name: 'Hours in use', type: 'number', isPriceMultiplier: true, price: 40 }
          ]
        }
      ])
    );
    expect(report.affected).toEqual([
      {
        serviceId: 'svc-1',
        name: 'Equipment use',
        isDeleted: false,
        parameters: [{ parameterId: 'hours', parameterName: 'Hours in use', pricedCategories: ['all categories'] }]
      }
    ]);
  });

  it('leaves an unpriced multiplier parameter alone — it still scales the line', async () => {
    const report = await auditMultiplierPricing(
      db([{ _id: 'svc-2', name: 'NGS', pricingMode: 'PARAMETER', parameters: [{ id: 'samples', name: 'Samples', type: 'number', isPriceMultiplier: true }] }])
    );
    expect(report.affected).toEqual([]);
    expect(report.unpricedMultiplierParameters).toBe(1);
  });

  it('ignores the universal run count, which never carries a price', async () => {
    const report = await auditMultiplierPricing(db([{ _id: 'svc-3', name: 'PCR', pricingMode: 'PARAMETER', parameters: [{ id: RUN_COUNT_PARAM_ID, isPriceMultiplier: true, price: 5 }] }]));
    expect(report.affected).toEqual([]);
  });

  it('ignores SERVICE-mode services, where a parameter price is never read', async () => {
    const report = await auditMultiplierPricing(db([{ _id: 'svc-4', name: 'Flat', pricingMode: 'SERVICE', price: 100, parameters: [{ id: 'hours', isPriceMultiplier: true, price: 40 }] }]));
    expect(report.affected).toEqual([]);
    expect(report.parameterModeServices).toBe(0);
  });

  it('reports a per-category price, so a service priced for one tier only is still caught', async () => {
    const report = await auditMultiplierPricing(
      db([
        {
          _id: 'svc-5',
          name: 'Bench time',
          pricingMode: 'PARAMETER',
          parameters: [{ id: 'hours', name: 'Hours', type: 'number', isPriceMultiplier: true, pricing: { internal: 20 } }]
        }
      ])
    );
    expect(report.affected[0].parameters[0].pricedCategories).toEqual(['INTERNAL_CUSTOMERS']);
  });

  it('counts what it scanned, so an empty report can be told from an empty catalog', async () => {
    const report = await auditMultiplierPricing(db([]));
    expect(report).toMatchObject({ scannedServices: 0, parameterModeServices: 0, affected: [] });
  });
});
