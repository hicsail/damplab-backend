import { gql, resetDb, seedService, startTestApp, stopTestApp, TestApp } from './harness';
import * as F from './sow-flow';

/**
 * Invoicing a job that uses the same catalog service twice.
 *
 * This needs a database because the shape only exists end to end: two workflow
 * nodes of one service, priced differently by their own parameters, become two
 * SOW lines with one shared `serviceId`. Both have to reach the invoice at their
 * own prices — a map keyed on that shared id once made the second overwrite the
 * first, and a version restates every contracted line, so one of them being lost
 * would be lost on every version.
 */

jest.setTimeout(60000);

/** Parameter-priced, so two nodes of it can carry genuinely different costs. */
const SEQUENCING = {
  name: 'Sequencing',
  pricingMode: 'PARAMETER',
  price: undefined,
  internalPrice: undefined,
  externalAcademicPrice: undefined,
  externalMarketPrice: undefined,
  externalNoSalaryPrice: undefined,
  parameters: [
    { id: 'kit', name: 'Kit', type: 'dropdown', options: [{ id: 'standard', name: 'Standard', price: 50 }] },
    { id: 'samples', name: 'Samples', type: 'number', isPriceMultiplier: true }
  ]
};

const node = (id: string, samples: number): Record<string, unknown> => ({
  id,
  label: 'Sequencing',
  serviceId: '',
  additionalInstructions: '',
  formData: [
    { id: 'kit', value: 'standard' },
    { id: 'samples', value: samples }
  ]
});

describe('invoicing a job that uses one service twice', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await startTestApp();
  });
  afterAll(async () => {
    await stopTestApp(ctx);
  });
  beforeEach(async () => {
    await resetDb(ctx);
  });

  /** A job with two Sequencing nodes at $100 and $250, and a SOW issued for it. */
  async function jobWithTwoLines(): Promise<{ jobId: string; sowId: string; billable: any[] }> {
    const serviceId = await seedService(ctx, SEQUENCING);
    const workflow = {
      name: 'Workflow A',
      nodes: [
        { ...node('node-1', 2), serviceId },
        { ...node('node-2', 5), serviceId }
      ],
      edges: []
    };

    const job = await F.createJob(ctx, 'customer', [workflow]);
    await F.reviewJob(ctx, 'staff', job.id, 'ACCEPT', `op-accept-${job.id}`);
    const sow = await F.createSowForJob(ctx, 'staff', job.id);
    const fresh = await F.readSow(ctx, 'staff', sow.id);
    await F.saveSowVersion(ctx, 'staff', sow.id, fresh.currentVersion, { note: 'Filled in' });
    await F.sendSowToCustomer(ctx, 'staff', sow.id);

    // Signed and countersigned, because invoicing now requires a FINAL version in
    // force. These tests are about which service *lines* an invoice covers, not
    // about that gate — see invoice-countersign-gate.spec.ts for the gate itself.
    const sent = await F.readSow(ctx, 'staff', sow.id);
    await F.signSow(ctx, 'customer', sow.id, F.signatureFor(sent.activeVersion, 'Cara Client'));
    await F.finalizeSow(ctx, 'staff', sow.id, 'Tess Technician');

    const billable = await billableServices(sow.id);
    return { jobId: job.id, sowId: sow.id, billable };
  }

  async function billableServices(sowId: string): Promise<any[]> {
    const data = await gql(ctx, 'staff', `query ($id: ID!) { sowById(id: $id) { billableServices { serviceId name cost } } }`, { id: sowId });
    return data.sowById.billableServices;
  }

  async function createInvoice(jobId: string): Promise<any> {
    const data = await gql(ctx, 'staff', `mutation ($input: CreateInvoiceInput!) { createInvoice(input: $input) { id subtotal totalCost services { serviceId name cost } } }`, {
      input: { jobId }
    });
    return data.createInvoice;
  }

  it('exposes both lines separately, sharing one service id', async () => {
    const { billable } = await jobWithTwoLines();

    expect(billable).toHaveLength(2);
    expect(new Set(billable.map((s) => s.serviceId)).size).toBe(1);
    expect(billable.map((s) => s.cost)).toEqual([100, 250]);
  });

  it('bills both at their own prices rather than one of them twice', async () => {
    const { jobId } = await jobWithTwoLines();

    const invoice = await createInvoice(jobId);

    expect(invoice.services.map((s: any) => s.cost)).toEqual([100, 250]);
    expect({ subtotal: invoice.subtotal, totalCost: invoice.totalCost }).toEqual({ subtotal: 350, totalCost: 350 });
  });
});
