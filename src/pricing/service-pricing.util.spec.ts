import { DampLabService, ServicePricingMode } from '../services/models/damplab-service.model';
import {
  calculateServiceCost,
  calculateServiceCostBreakdown,
  CustomerCategory,
  EQUIPMENT_BOOKERS_PARAM_ID,
  EQUIPMENT_END_PARAM_ID,
  EQUIPMENT_HOURS_PER_WEEK_PARAM_ID,
  EQUIPMENT_OPEN_END_PARAM_ID,
  EQUIPMENT_START_PARAM_ID,
  equipmentFactor,
  equipmentWeeks,
  extractRunCount,
  RUN_COUNT_PARAM_ID
} from './service-pricing.util';

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

/**
 * The $0 line.
 *
 * A parameter-priced service has no flat price to quote, so its cost is computed
 * from the values the customer picked. When those values do not reach the
 * pricing call — the SOW's workflow sync rebuilds its service lines from the
 * job's nodes, and a node whose formData is missing arrives with none — the
 * computation has nothing to work from. It used to answer 0, which billed
 * nothing and discarded the figure the canvas had already computed.
 */
describe('calculateServiceCostBreakdown — a parameter-priced line with no values to price', () => {
  const parameterService = {
    pricingMode: ServicePricingMode.PARAMETER,
    parameters: [
      { id: 'kit', name: 'Kit', type: 'dropdown', options: [{ id: 'standard', name: 'Standard', price: 50 }] },
      { id: 'samples', name: 'Samples', type: 'number', isPriceMultiplier: true }
    ]
  } as unknown as DampLabService;

  it('prices from the selected values when it has them', () => {
    const formData = [
      { id: 'kit', value: 'standard' },
      { id: 'samples', value: 4 }
    ];
    expect(calculateServiceCostBreakdown(parameterService, formData, 999)).toEqual({ unitCost: 50, multiplier: 4, cost: 200 });
  });

  it.each([
    ['an empty array', []],
    ['undefined', undefined],
    ['null', null]
  ])('falls back to the price it was handed when formData is %s, rather than billing nothing', (_label, formData) => {
    expect(calculateServiceCostBreakdown(parameterService, formData, 200)).toEqual({ unitCost: 200, multiplier: 1, cost: 200 });
  });

  it('still answers 0 when there is no fallback either — that is genuinely unknown, not free', () => {
    expect(calculateServiceCostBreakdown(parameterService, [], undefined)).toEqual({ unitCost: 0, multiplier: 1, cost: 0 });
  });

  it('keeps a genuine zero that the selected values actually produce', () => {
    // The distinction the fallback is keyed on: values were supplied and they
    // priced to nothing. A fallback here would overwrite a real price.
    const freeOption = {
      pricingMode: ServicePricingMode.PARAMETER,
      parameters: [{ id: 'kit', name: 'Kit', type: 'dropdown', options: [{ id: 'free', name: 'Free', price: 0 }] }]
    } as unknown as DampLabService;
    expect(calculateServiceCostBreakdown(freeOption, [{ id: 'kit', value: 'free' }], 500)).toEqual({ unitCost: 0, multiplier: 1, cost: 0 });
  });
});

/**
 * THE shared table. damplab-ui/src/utils/servicePricing.equipment.test.ts holds a
 * byte-identical copy; the two implementations must agree case for case.
 */
const EQUIPMENT_FACTOR_CASES: Array<[string, string | undefined, string | undefined, unknown, number | undefined]> = [
  ['28 days is 4 weeks', '2026-01-01', '2026-01-29', 10, 40],
  ['29 days rounds up to 5 weeks', '2026-01-01', '2026-01-30', 10, 50],
  ['a same-day window is one week', '2026-01-01', '2026-01-01', 10, 10],
  ['7 days is exactly one week', '2026-01-01', '2026-01-08', 1, 1],
  ['8 days rounds up to 2 weeks', '2026-01-01', '2026-01-09', 2, 4],
  ['a missing end date has no factor', '2026-01-01', undefined, 10, undefined],
  ['a missing start date has no factor', undefined, '2026-01-29', 10, undefined],
  ['an end before the start has no factor', '2026-01-29', '2026-01-01', 10, undefined],
  ['a malformed date has no factor', '2026-01-01', 'next tuesday', 10, undefined],
  ['zero hours per week has no factor', '2026-01-01', '2026-01-29', 0, undefined],
  ['non-numeric hours per week has no factor', '2026-01-01', '2026-01-29', 'abc', undefined],
  ['hours per week sent as a string still counts', '2026-01-01', '2026-01-29', '10', 40]
];

const equipmentFormData = (start?: string, end?: string, hours?: unknown): Array<{ id: string; value: unknown }> => [
  ...(start === undefined ? [] : [{ id: EQUIPMENT_START_PARAM_ID, value: start }]),
  ...(end === undefined ? [] : [{ id: EQUIPMENT_END_PARAM_ID, value: end }]),
  ...(hours === undefined ? [] : [{ id: EQUIPMENT_HOURS_PER_WEEK_PARAM_ID, value: hours }]),
  { id: EQUIPMENT_OPEN_END_PARAM_ID, value: false },
  { id: EQUIPMENT_BOOKERS_PARAM_ID, value: [] }
];

describe('equipmentWeeks', () => {
  it('counts whole weeks, rounding any partial week up, with one week as the floor', () => {
    expect(equipmentWeeks('2026-01-01', '2026-01-29')).toBe(4);
    expect(equipmentWeeks('2026-01-01', '2026-01-30')).toBe(5);
    expect(equipmentWeeks('2026-01-01', '2026-01-01')).toBe(1);
  });

  it('is undefined rather than throwing on a window it cannot read', () => {
    expect(equipmentWeeks(undefined, '2026-01-29')).toBeUndefined();
    expect(equipmentWeeks('2026-01-29', '2026-01-01')).toBeUndefined();
    expect(equipmentWeeks('2026-01-01', '')).toBeUndefined();
  });

  it('does not shift across a DST boundary', () => {
    // 2026-03-08 is the US spring-forward. Parsed as local dates this window
    // is 27.96 days and would round to 4 weeks either way; parsed as UTC it
    // is exactly 28. The assertion pins the UTC reading.
    expect(equipmentWeeks('2026-02-22', '2026-03-22')).toBe(4);
  });
});

describe('equipmentFactor', () => {
  it.each(EQUIPMENT_FACTOR_CASES)('%s', (_label, start, end, hours, expected) => {
    expect(equipmentFactor(equipmentFormData(start, end, hours))).toBe(expected);
  });

  it('is undefined when none of the reserved entries are present', () => {
    expect(equipmentFactor([{ id: 'vol', value: 5 }])).toBeUndefined();
    expect(equipmentFactor(undefined)).toBeUndefined();
  });
});

describe('calculateServiceCostBreakdown — equipment estimate', () => {
  it('prices 10 hrs/wk at $40/hr over 28 days as $1,600', () => {
    const b = calculateServiceCostBreakdown(service({ price: 40 }), equipmentFormData('2026-01-01', '2026-01-29', 10));
    expect(b.unitCost).toBe(40);
    expect(b.multiplier).toBe(40);
    expect(b.cost).toBe(1600);
  });

  it('stacks the run count on top of the equipment factor', () => {
    const formData = [...equipmentFormData('2026-01-01', '2026-01-29', 10), { id: RUN_COUNT_PARAM_ID, value: 2 }];
    expect(calculateServiceCostBreakdown(service({ price: 40 }), formData).multiplier).toBe(80);
  });

  it('leaves the price alone rather than throwing when the window is unusable', () => {
    // The submission validator blocks an incomplete window; the pricer must not.
    expect(calculateServiceCost(service({ price: 40 }), equipmentFormData('2026-01-01', undefined, 10))).toBe(40);
    expect(calculateServiceCost(service({ price: 40 }), equipmentFormData('2026-01-29', '2026-01-01', 10))).toBe(40);
  });
});
