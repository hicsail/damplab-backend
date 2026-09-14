import { gql, resetDb, seedService, startTestApp, stopTestApp, TestApp } from './harness';
import * as F from './sow-flow';

/**
 * The job's customer pricing category, and the catalog's prices, reaching the
 * SOW's figures.
 *
 * Integration rather than unit because the claim spans four components that each
 * looked correct in isolation: the catalog's own normalization of a service's
 * price fields, the pricing utility's category resolution, the workflow → SOW
 * sync, and the mutation that changes a job's category. The two bugs here both
 * lived in the seams between them.
 */
jest.setTimeout(60000);

/** Every tier priced differently, so a fallback is never mistaken for a hit. */
const TIERS = { INTERNAL_CUSTOMERS: 10, EXTERNAL_CUSTOMER_ACADEMIC: 150, EXTERNAL_CUSTOMER_MARKET: 250, EXTERNAL_CUSTOMER_NO_SALARY: 200 };

/**
 * A service whose tiers live ONLY in the deprecated flat fields, with no
 * `pricing` object — what every service looks like until someone re-saves it
 * through AdminEditService, which is the shape the category bug hid behind.
 */
const FLAT_ONLY = {
  name: 'Flat only',
  pricingMode: 'SERVICE',
  price: 100,
  internalPrice: 10,
  externalAcademicPrice: 150,
  externalMarketPrice: 250,
  externalNoSalaryPrice: 200,
  pricing: undefined
};

/** The same prices as AdminEditService writes them today: a full `pricing` object. */
const PRICING_OBJECT = {
  name: 'Tiered PCR',
  pricingMode: 'SERVICE',
  price: 100,
  internalPrice: 10,
  externalPrice: 250,
  externalAcademicPrice: 150,
  externalMarketPrice: 250,
  externalNoSalaryPrice: 200,
  pricing: { internal: 10, external: 250, externalAcademic: 150, externalMarket: 250, externalNoSalary: 200, legacy: 100 }
};

/** Option-level pricing, flat fields only. */
const FLAT_OPTION = {
  name: 'Flat option',
  pricingMode: 'PARAMETER',
  price: undefined,
  internalPrice: undefined,
  parameters: [
    {
      id: 'kit',
      name: 'Kit',
      type: 'dropdown',
      options: [{ id: 'standard', name: 'Standard', price: 100, internalPrice: 10, externalAcademicPrice: 150, externalMarketPrice: 250, externalNoSalaryPrice: 200 }]
    }
  ]
};

const CHANGE_CATEGORY = `
  mutation ($jobId: ID!, $customerCategory: CustomerCategory!) {
    changeJobCustomerCategory(jobId: $jobId, customerCategory: $customerCategory) { id customerCategory }
  }
`;

const READ_SOW = `
  query ($jobId: ID!) {
    sowByJobId(jobId: $jobId) {
      id
      services { serviceId name cost }
      liveServices { serviceId name cost }
    }
  }
`;

const UPDATE_SERVICE = `
  mutation ($service: ID!, $changes: ServiceChange!) {
    updateService(service: $service, changes: $changes) { id }
  }
`;

describe('customer pricing category → SOW figures', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startTestApp();
  });
  afterAll(async () => {
    await stopTestApp(testApp);
  });
  beforeEach(async () => {
    await resetDb(testApp);
  });

  async function jobWithSow(overrides: Record<string, unknown>, formData: unknown[], category: string): Promise<{ jobId: string; serviceId: string }> {
    const serviceId = await seedService(testApp, overrides);
    const workflow = {
      name: 'W',
      nodes: [{ id: 'node-1', label: String(overrides.name), serviceId, additionalInstructions: '', formData }],
      edges: []
    };
    const job = await F.createJob(testApp, 'customer', [workflow]);
    await gql(testApp, 'staff', CHANGE_CATEGORY, { jobId: job.id, customerCategory: category });
    await F.createSowForJob(testApp, 'staff', job.id);
    return { jobId: job.id, serviceId };
  }

  async function sowCost(jobId: string): Promise<number> {
    const { sowByJobId } = await gql(testApp, 'staff', READ_SOW, { jobId });
    return Number(sowByJobId.services[0].cost);
  }

  describe('operation-level pricing', () => {
    it.each(Object.entries(TIERS))('bills the %s price when the tiers live in a pricing object', async (category, expected) => {
      const { jobId } = await jobWithSow(PRICING_OBJECT, [], category);
      expect(await sowCost(jobId)).toBe(expected);
    });

    it.each(Object.entries(TIERS))('bills the %s price when the tiers live only in the flat deprecated fields', async (category, expected) => {
      // The regression: calculateServiceCostBreakdown built a partial input for
      // resolveCategoryPrice that omitted externalAcademicPrice /
      // externalMarketPrice / externalNoSalaryPrice, so all three external tiers
      // fell through to `legacy` — $100 for everyone but internal customers.
      const { jobId } = await jobWithSow(FLAT_ONLY, [], category);
      expect(await sowCost(jobId)).toBe(expected);
    });
  });

  describe('option-level pricing', () => {
    it.each(Object.entries(TIERS))('bills the %s price from the selected option', async (category, expected) => {
      const { jobId } = await jobWithSow(FLAT_OPTION, [{ id: 'kit', value: 'standard' }], category);
      expect(await sowCost(jobId)).toBe(expected);
    });
  });

  describe('changing the category on a job that already has a SOW', () => {
    it('reprices the billing core', async () => {
      const { jobId } = await jobWithSow(PRICING_OBJECT, [], 'INTERNAL_CUSTOMERS');
      expect(await sowCost(jobId)).toBe(10);

      await gql(testApp, 'staff', CHANGE_CATEGORY, { jobId, customerCategory: 'EXTERNAL_CUSTOMER_MARKET' });

      expect(await sowCost(jobId)).toBe(250);
    });

    it('reprices a flat-only service too', async () => {
      const { jobId } = await jobWithSow(FLAT_ONLY, [], 'INTERNAL_CUSTOMERS');
      await gql(testApp, 'staff', CHANGE_CATEGORY, { jobId, customerCategory: 'EXTERNAL_CUSTOMER_ACADEMIC' });
      expect(await sowCost(jobId)).toBe(150);
    });
  });

  describe('a catalog price edited after the SOW exists', () => {
    it('reaches liveServices, which is what Recalculate pulls', async () => {
      // liveServices used to return the stored billing core, which only a
      // workflow edit or a category change ever refreshed — so a price corrected
      // in the catalog could never be pulled into the document at all.
      const { jobId, serviceId } = await jobWithSow(PRICING_OBJECT, [], 'INTERNAL_CUSTOMERS');
      expect(await sowCost(jobId)).toBe(10);

      await gql(testApp, 'staff', UPDATE_SERVICE, {
        service: serviceId,
        changes: { pricing: { internal: 999, external: 250, externalAcademic: 150, externalMarket: 250, externalNoSalary: 200, legacy: 100 } }
      });

      const { sowByJobId } = await gql(testApp, 'staff', READ_SOW, { jobId });
      expect(Number(sowByJobId.liveServices[0].cost)).toBe(999);
    });

    it('picks up a new option price for a parameter-priced line', async () => {
      const { jobId, serviceId } = await jobWithSow(FLAT_OPTION, [{ id: 'kit', value: 'standard' }], 'EXTERNAL_CUSTOMER_ACADEMIC');
      expect(await sowCost(jobId)).toBe(150);

      await gql(testApp, 'staff', UPDATE_SERVICE, {
        service: serviceId,
        changes: {
          parameters: [
            {
              id: 'kit',
              name: 'Kit',
              type: 'dropdown',
              options: [{ id: 'standard', name: 'Standard', price: 100, internalPrice: 10, externalAcademicPrice: 175, externalMarketPrice: 250, externalNoSalaryPrice: 200 }]
            }
          ]
        }
      });

      const { sowByJobId } = await gql(testApp, 'staff', READ_SOW, { jobId });
      expect(Number(sowByJobId.liveServices[0].cost)).toBe(175);
    });
  });

  describe('saving a Fee Schedule refresh', () => {
    async function repriceAndSave(refreshFeeSchedule: boolean): Promise<number> {
      const { jobId, serviceId } = await jobWithSow(PRICING_OBJECT, [], 'INTERNAL_CUSTOMERS');
      const { sowByJobId } = await gql(testApp, 'staff', READ_SOW, { jobId });
      const version = await F.readSow(testApp, 'staff', sowByJobId.id);

      await gql(testApp, 'staff', UPDATE_SERVICE, {
        service: serviceId,
        changes: { pricing: { internal: 999, external: 250, externalAcademic: 150, externalMarket: 250, externalNoSalary: 200, legacy: 100 } }
      });

      const saved = await F.saveSowVersion(testApp, 'staff', sowByJobId.id, version.currentVersion, { note: 'Recalculated', refreshFeeSchedule });
      return Number(saved.inputs.services[0].cost);
    }

    it('persists the catalog price the editor showed, not the stale stored one', async () => {
      // The editor patches its local figures from `liveServices`, but the save
      // re-derives from the SOW's billing core. Without the refresh syncing that
      // core first, Recalculate showed the new price and saved the old one.
      expect(await repriceAndSave(true)).toBe(999);
    });

    it('leaves the figures alone on a save that is not a refresh', async () => {
      // The static-record rule: a staff member fixing a typo must not silently
      // reprice a document that may already be sent or signed.
      expect(await repriceAndSave(false)).toBe(10);
    });
  });
});
