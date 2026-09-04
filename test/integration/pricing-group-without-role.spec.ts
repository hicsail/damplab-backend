import { ACTORS, gql, resetDb, seedService, startTestApp, stopTestApp, TestApp } from './harness';
import * as F from './sow-flow';

/**
 * A customer whose pricing tier is a Keycloak **group** with no associated realm
 * role, and whose token carries no `groups` claim.
 *
 * This is the documented arrangement (docs/access-matrix.md: "Pricing is a
 * separate axis entirely... determine price and have no access effect"), and it
 * is the shape that silently billed the fallback price. Group memberships reach
 * a token only when the realm's client carries a Group Membership mapper —
 * nothing in this repository configures, documents or can verify that — so
 * deriving the category from the token alone resolved to `undefined`, and
 * `resolveCategoryPrice` returned the fallback for every category, in both
 * pricing modes.
 */
jest.setTimeout(60000);

const ACADEMIC_GROUP = [{ name: 'external-customer-academic', path: '/external-customer-academic' }];

/** Every tier priced apart, so a fallback can never be mistaken for a hit. */
const TIERED = {
  name: 'Tiered PCR',
  pricingMode: 'SERVICE',
  price: 100,
  internalPrice: 10,
  externalAcademicPrice: 150,
  externalMarketPrice: 250,
  externalNoSalaryPrice: 200,
  pricing: { internal: 10, external: 250, externalAcademic: 150, externalMarket: 250, externalNoSalary: 200, legacy: 100 }
};

const PARAM_TIERED = {
  name: 'Param tiered',
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

const READ_SOW = `
  query ($jobId: ID!) {
    sowByJobId(jobId: $jobId) { id services { cost } }
  }
`;

const JOB_CATEGORY = `
  query ($id: ID!) {
    jobById(id: $id) { id customerCategory }
  }
`;

describe('a pricing group with no realm role, absent from the token', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startTestApp({ keycloakGroupsBySub: { [ACTORS.groupOnlyCustomer.sub as string]: ACADEMIC_GROUP } });
  });
  afterAll(async () => {
    await stopTestApp(testApp);
  });
  beforeEach(async () => {
    await resetDb(testApp);
  });

  async function submitAndPrice(overrides: Record<string, unknown>, formData: unknown[]): Promise<{ jobId: string; cost: number; category: string | null }> {
    const serviceId = await seedService(testApp, overrides);
    const workflow = {
      name: 'W',
      nodes: [{ id: 'node-1', label: String(overrides.name), serviceId, additionalInstructions: '', formData }],
      edges: []
    };
    const job = await F.createJob(testApp, 'groupOnlyCustomer', [workflow]);
    await F.createSowForJob(testApp, 'staff', job.id);
    const { sowByJobId } = await gql(testApp, 'staff', READ_SOW, { jobId: job.id });
    const { jobById } = await gql(testApp, 'staff', JOB_CATEGORY, { id: job.id });
    return { jobId: job.id, cost: Number(sowByJobId.services[0].cost), category: jobById.customerCategory ?? null };
  }

  it('stamps the job with the category its group implies', async () => {
    const { category } = await submitAndPrice(TIERED, []);
    expect(category).toBe('EXTERNAL_CUSTOMER_ACADEMIC');
  });

  it('bills operation-level pricing at the academic rate, not the fallback', async () => {
    // Was $100 — the catalogue's fallback — for a customer entitled to $150.
    const { cost } = await submitAndPrice(TIERED, []);
    expect(cost).toBe(150);
  });

  it('bills parameter/option-level pricing at the academic rate, not the fallback', async () => {
    const { cost } = await submitAndPrice(PARAM_TIERED, [{ id: 'kit', value: 'standard' }]);
    expect(cost).toBe(150);
  });

  it('carries that same figure onto the invoice', async () => {
    // The half already working, pinned so this change cannot regress it.
    const { jobId, cost } = await submitAndPrice(TIERED, []);
    expect(cost).toBe(150);

    const { sowByJobId } = await gql(testApp, 'staff', `query ($jobId: ID!) { sowByJobId(jobId: $jobId) { billableServices { serviceId } } }`, { jobId });
    const invoice = await gql(testApp, 'staff', `mutation ($input: CreateInvoiceInput!) { createInvoice(input: $input) { subtotal totalCost services { cost } } }`, {
      input: { jobId, services: [{ index: 0, serviceId: sowByJobId.billableServices[0].serviceId }] }
    });
    expect(Number(invoice.createInvoice.services[0].cost)).toBe(150);
    expect(Number(invoice.createInvoice.totalCost)).toBe(150);
  });

  it('answers myPermissions with the resolved category, so the UI agrees with the documents', async () => {
    const { myPermissions } = await gql(testApp, 'groupOnlyCustomer', `query { myPermissions { customerCategory } }`);
    expect(myPermissions.customerCategory).toBe('EXTERNAL_CUSTOMER_ACADEMIC');
  });
});
