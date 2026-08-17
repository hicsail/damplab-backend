import { DampLabService, ServicePricingMode } from '../services/models/damplab-service.model';
import { calculateServiceCost, extractRunCount, RUN_COUNT_PARAM_ID } from './service-pricing.util';

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
