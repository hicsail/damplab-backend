import { DampLabService, ServicePricingMode } from '../services/models/damplab-service.model';
import { calculateServiceCost, calculateServiceCostBreakdown, CustomerCategory, extractRunCount, RUN_COUNT_PARAM_ID } from './service-pricing.util';

/**
 * The universal run count is injected into formData client-side under a synthetic
 * id and is deliberately not part of the stored service.parameters. The backend
 * must therefore read it straight from formData, the same way the UI does, or a
 * SOW save fails its own pricing consistency check.
 */
function service(overrides: Partial<DampLabService> = {}): DampLabService {
  return {
    price: 5,
    pricingMode: ServicePricingMode.SERVICE,
    parameters: [],
    ...overrides
  } as unknown as DampLabService;
}

describe('calculateServiceCost — run count multiplier', () => {
  it('multiplies a SERVICE-priced service by the run count from formData', () => {
    const formData = [{ id: RUN_COUNT_PARAM_ID, value: 70 }];
    expect(calculateServiceCost(service(), formData)).toBe(350);
  });

  it('accepts a run count sent as a string', () => {
    const formData = [{ id: RUN_COUNT_PARAM_ID, value: '70' }];
    expect(calculateServiceCost(service(), formData)).toBe(350);
  });

  it('leaves the cost alone when no run count is present', () => {
    expect(calculateServiceCost(service(), [])).toBe(5);
  });

  it('treats a run count of 1 as a no-op', () => {
    expect(calculateServiceCost(service(), [{ id: RUN_COUNT_PARAM_ID, value: 1 }])).toBe(5);
  });

  it('ignores a zero or non-numeric run count rather than zeroing the price', () => {
    expect(calculateServiceCost(service(), [{ id: RUN_COUNT_PARAM_ID, value: 0 }])).toBe(5);
    expect(calculateServiceCost(service(), [{ id: RUN_COUNT_PARAM_ID, value: 'abc' }])).toBe(5);
  });

  it('multiplies PARAMETER-priced services too', () => {
    const svc = service({
      pricingMode: ServicePricingMode.PARAMETER,
      parameters: [{ id: 'samples', price: 3, type: 'number' }]
    } as Partial<DampLabService>);
    const formData = [
      { id: 'samples', value: 2 },
      { id: RUN_COUNT_PARAM_ID, value: 70 }
    ];
    // 1 priced parameter value at $3, multiplied by 70 runs
    expect(calculateServiceCost(svc, formData)).toBe(210);
  });

  it('does not double-count when the service also declares the run count as a multiplier', () => {
    const svc = service({
      parameters: [{ id: RUN_COUNT_PARAM_ID, isPriceMultiplier: true }]
    } as Partial<DampLabService>);
    expect(calculateServiceCost(svc, [{ id: RUN_COUNT_PARAM_ID, value: 70 }])).toBe(350);
  });

  it('still applies other isPriceMultiplier parameters alongside the run count', () => {
    const svc = service({
      parameters: [{ id: 'plates', isPriceMultiplier: true }]
    } as Partial<DampLabService>);
    const formData = [
      { id: 'plates', value: 3 },
      { id: RUN_COUNT_PARAM_ID, value: 70 }
    ];
    expect(calculateServiceCost(svc, formData)).toBe(1050);
  });
});

describe('extractRunCount', () => {
  it('reads the run count out of formData, the same figure getMultiplier uses', () => {
    expect(extractRunCount([{ id: RUN_COUNT_PARAM_ID, value: 70 }])).toBe(70);
  });

  it('is undefined when no run count entry is present', () => {
    expect(extractRunCount([{ id: 'unrelated', value: 1 }])).toBeUndefined();
    expect(extractRunCount(undefined)).toBeUndefined();
  });

  it('reads the legacy object-keyed formData shape too', () => {
    expect(extractRunCount({ [RUN_COUNT_PARAM_ID]: 70 })).toBe(70);
  });
});

/**
 * The Fee Schedule quotes "$5.00 x 70 = $350.00" and the SOW editor edits the
 * $5.00, so the two figures behind the total have to come back out of the
 * calculation rather than be recovered from it — a unit price of 0 is legal, so
 * dividing the total by the multiplier is not an option.
 */
describe('calculateServiceCostBreakdown', () => {
  it('returns the unit price and multiplier behind the total', () => {
    expect(calculateServiceCostBreakdown(service(), [{ id: RUN_COUNT_PARAM_ID, value: 70 }])).toEqual({ unitCost: 5, multiplier: 70, cost: 350 });
  });

  it('reports a multiplier of 1 when nothing multiplies the line', () => {
    expect(calculateServiceCostBreakdown(service(), [])).toEqual({ unitCost: 5, multiplier: 1, cost: 5 });
  });

  it('folds every multiplier parameter into the one figure', () => {
    const svc = service({ parameters: [{ id: 'plates', isPriceMultiplier: true }] } as Partial<DampLabService>);
    const formData = [
      { id: 'plates', value: 3 },
      { id: RUN_COUNT_PARAM_ID, value: 70 }
    ];
    expect(calculateServiceCostBreakdown(svc, formData)).toEqual({ unitCost: 5, multiplier: 210, cost: 1050 });
  });

  it('normalises a zero or unusable multiplier to 1, as the total already does', () => {
    expect(calculateServiceCostBreakdown(service(), [{ id: RUN_COUNT_PARAM_ID, value: 0 }])).toEqual({ unitCost: 5, multiplier: 1, cost: 5 });
  });

  it('keeps a free service free rather than making its unit price unrecoverable', () => {
    const free = service({ price: 0 });
    expect(calculateServiceCostBreakdown(free, [{ id: RUN_COUNT_PARAM_ID, value: 70 }])).toEqual({ unitCost: 0, multiplier: 70, cost: 0 });
  });
});

/**
 * Category pricing had no coverage at all before Phase 0: no spec passed a category
 * argument, so `resolveCategoryPrice`'s silent fallthrough to `pricing.legacy` was
 * invisible. That fallthrough is exactly what default external customers were being
 * billed at while `external-customers` was missing from the group list.
 */
describe('calculateServiceCost — customer category pricing', () => {
  const tiered = (): DampLabService =>
    service({
      price: 100,
      pricing: {
        legacy: 100,
        internal: 10,
        externalAcademic: 20,
        externalMarket: 30,
        externalNoSalary: 40
      }
    } as Partial<DampLabService>);

  it.each([
    [CustomerCategory.INTERNAL_CUSTOMERS, 10],
    [CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC, 20],
    [CustomerCategory.EXTERNAL_CUSTOMER_MARKET, 30],
    [CustomerCategory.EXTERNAL_CUSTOMER_NO_SALARY, 40]
  ])('prices %s at its own tier', (category, expected) => {
    expect(calculateServiceCost(tiered(), [], undefined, category)).toBe(expected);
  });

  it('falls back to the legacy price when the category is undefined — silently, by design', () => {
    // Pinned deliberately: this is the branch an uncategorised user lands in, and
    // it logs nothing. Phase 0 stops `external-customers` reaching it.
    expect(calculateServiceCost(tiered(), [], undefined, undefined)).toBe(100);
  });

  it('falls back to the flat price when there is no legacy price either', () => {
    expect(calculateServiceCost(service({ price: 7, pricing: undefined } as Partial<DampLabService>), [], undefined, undefined)).toBe(7);
  });

  it('falls back through `external` when a tier has no price of its own', () => {
    const svc = service({ price: 100, pricing: { legacy: 100, external: 55 } } as Partial<DampLabService>);
    expect(calculateServiceCost(svc, [], undefined, CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC)).toBe(55);
    expect(calculateServiceCost(svc, [], undefined, CustomerCategory.EXTERNAL_CUSTOMER_MARKET)).toBe(55);
    expect(calculateServiceCost(svc, [], undefined, CustomerCategory.EXTERNAL_CUSTOMER_NO_SALARY)).toBe(55);
  });

  it('does not use `external` for internal customers', () => {
    const svc = service({ price: 100, pricing: { legacy: 100, external: 55 } } as Partial<DampLabService>);
    expect(calculateServiceCost(svc, [], undefined, CustomerCategory.INTERNAL_CUSTOMERS)).toBe(100);
  });
});
