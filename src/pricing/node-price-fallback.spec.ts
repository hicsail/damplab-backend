import { calculateServiceCostBreakdown } from './service-pricing.util';
import { CustomerCategory } from './customer-category';
import { ServicePricingMode } from '../services/models/damplab-service.model';

/**
 * `node.price` is a fallback, never an authority.
 *
 * `AddNodeInputPipe` prices a node from the **requesting user's** Keycloak
 * identity, which is right at checkout and wrong whenever staff act on a
 * customer's job: a technician adding a node stamps it at the staff tier. That is
 * knowingly left in place rather than resolved through the Admin API, because the
 * requester is the wrong identity even when resolved perfectly and it would cost a
 * round trip per node on every canvas edit.
 *
 * What makes it acceptable is exactly what these pin: whenever the catalog can
 * price a service, the stored node price is ignored and the line is repriced from
 * `job.customerCategory`. The fallback is reached only when the catalog can say
 * nothing at all. If any of these fail, the mis-tiered figure has become
 * authoritative and the reasoning above no longer holds.
 *
 * This pins the *boundary*. That the SOW actually reprices through it end to end
 * is `test/integration/sow-customer-category.spec.ts`; both are named in the
 * comment at `AddNodeInputPipe`.
 */

const OPERATION_PRICED = {
  pricingMode: ServicePricingMode.SERVICE,
  parameters: [],
  pricing: { internal: 100, externalAcademic: 150, externalMarket: 200, legacy: 90 }
} as any;

const PARAMETER_PRICED = {
  pricingMode: ServicePricingMode.PARAMETER,
  parameters: [{ id: 'instrument', name: 'Instrument', type: 'dropdown', options: [{ id: 'bio', name: 'Bioanalyzer', pricing: { internal: 40, externalAcademic: 75 } }] }]
} as any;

/** A staff-tier figure the pipe would have stamped on the node. */
const STAFF_STAMPED_PRICE = 100;

describe('the SOW ignores node.price when the catalog can price the service', () => {
  it('reprices an operation-priced line at the job’s category, not the stored figure', () => {
    const breakdown = calculateServiceCostBreakdown(OPERATION_PRICED, {}, STAFF_STAMPED_PRICE, CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC);

    expect(breakdown.unitCost).toBe(150);
    expect(breakdown.cost).toBe(150);
  });

  it('ignores a stored line total too, not just a stored unit price', () => {
    const breakdown = calculateServiceCostBreakdown(OPERATION_PRICED, {}, undefined, CustomerCategory.EXTERNAL_CUSTOMER_MARKET, { fallbackLineCost: STAFF_STAMPED_PRICE });

    expect(breakdown.unitCost).toBe(200);
  });

  it('reprices a parameter-priced line from the selections, not the stored figure', () => {
    const breakdown = calculateServiceCostBreakdown(PARAMETER_PRICED, { instrument: 'bio' }, STAFF_STAMPED_PRICE, CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC);

    expect(breakdown.unitCost).toBe(75);
  });

  it('still reprices when the job has no category, ending at the legacy tier', () => {
    // The uncategorised chain is `legacy ?? price` — still the catalog, still not
    // the requester's stamp.
    const breakdown = calculateServiceCostBreakdown(OPERATION_PRICED, {}, STAFF_STAMPED_PRICE, undefined);

    expect(breakdown.unitCost).toBe(90);
  });

  it('reprices a genuine zero rather than treating it as unpriceable', () => {
    const free = { pricingMode: ServicePricingMode.SERVICE, parameters: [], pricing: { internal: 0, legacy: 90 } } as any;
    const breakdown = calculateServiceCostBreakdown(free, {}, STAFF_STAMPED_PRICE, CustomerCategory.INTERNAL_CUSTOMERS);

    expect(breakdown.unitCost).toBe(0);
  });
});

describe('the fallback is reached only when the catalog can say nothing', () => {
  it('uses the stored unit price for a service the catalog cannot price at all', () => {
    const unpriceable = { pricingMode: ServicePricingMode.SERVICE, parameters: [] } as any;
    const breakdown = calculateServiceCostBreakdown(unpriceable, {}, STAFF_STAMPED_PRICE, CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC);

    expect(breakdown.unitCost).toBe(STAFF_STAMPED_PRICE);
  });

  it('uses the stored figure for a parameter-priced line whose selections did not reach us', () => {
    // Keyed on "no values at all", not on "the total came out 0" — a genuine zero
    // is a real price and must survive.
    const breakdown = calculateServiceCostBreakdown(PARAMETER_PRICED, {}, STAFF_STAMPED_PRICE, CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC);

    expect(breakdown.unitCost).toBe(STAFF_STAMPED_PRICE);
  });

  it('divides a stored LINE total back down before using it as a unit price', () => {
    // A workflow node's cost has the multiplier already applied; feeding it in as a
    // unit price is what billed a priceless service `unit x N x N`.
    const withRunCount = { pricingMode: ServicePricingMode.SERVICE, parameters: [{ id: '__runCount', name: 'Number of runs', type: 'number', isPriceMultiplier: true }] } as any;
    const breakdown = calculateServiceCostBreakdown(withRunCount, { __runCount: 4 }, undefined, undefined, { fallbackLineCost: 400 });

    expect(breakdown).toMatchObject({ unitCost: 100, multiplier: 4, cost: 400 });
  });
});
