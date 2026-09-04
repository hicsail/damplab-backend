import { getModelToken } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { gql, gqlError, resetDb, seedService, startTestApp, stopTestApp, TestApp } from './harness';
import * as F from './sow-flow';
import { Invoice } from '../../src/invoice/invoice.model';

/**
 * Invoicing a job that uses the same catalog service twice.
 *
 * This needs a database because the shape only exists end to end: two workflow
 * nodes of one service, priced differently by their own parameters, become two
 * SOW lines with one shared `serviceId`. Selection used to resolve those through
 * a map keyed on that id, so the second line overwrote the first and picking
 * both billed the last one twice.
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

    const billable = await billableServices(sow.id);
    return { jobId: job.id, sowId: sow.id, billable };
  }

  async function billableServices(sowId: string): Promise<any[]> {
    const data = await gql(ctx, 'staff', `query ($id: ID!) { sowById(id: $id) { billableServices { serviceId name cost } } }`, { id: sowId });
    return data.sowById.billableServices;
  }

  async function createInvoice(services: Array<{ index: number; serviceId: string }>, jobId: string): Promise<any> {
    const data = await gql(ctx, 'staff', `mutation ($input: CreateInvoiceInput!) { createInvoice(input: $input) { id subtotal totalCost services { serviceId name cost } } }`, {
      input: { jobId, services }
    });
    return data.createInvoice;
  }

  async function createInvoiceError(input: Record<string, unknown>): Promise<string> {
    return gqlError(ctx, 'staff', `mutation ($input: CreateInvoiceInput!) { createInvoice(input: $input) { id } }`, { input });
  }

  async function invoiceCount(): Promise<number> {
    const model = ctx.app.get<mongoose.Model<any>>(getModelToken(Invoice.name));
    return model.countDocuments({}).exec();
  }

  it('exposes both lines separately, sharing one service id', async () => {
    const { billable } = await jobWithTwoLines();

    expect(billable).toHaveLength(2);
    expect(new Set(billable.map((s) => s.serviceId)).size).toBe(1);
    expect(billable.map((s) => s.cost)).toEqual([100, 250]);
  });

  it('bills both at their own prices rather than one of them twice', async () => {
    const { jobId, billable } = await jobWithTwoLines();

    const invoice = await createInvoice(
      billable.map((s, index) => ({ index, serviceId: s.serviceId })),
      jobId
    );

    expect(invoice.services.map((s: any) => s.cost)).toEqual([100, 250]);
    expect({ subtotal: invoice.subtotal, totalCost: invoice.totalCost }).toEqual({ subtotal: 350, totalCost: 350 });
  });

  it('can bill only the second line, which sharing an id used to make impossible', async () => {
    const { jobId, billable } = await jobWithTwoLines();

    const invoice = await createInvoice([{ index: 1, serviceId: billable[1].serviceId }], jobId);

    expect(invoice.services).toHaveLength(1);
    expect(invoice.services[0].cost).toBe(250);
    expect(invoice.subtotal).toBe(250);
  });

  it('refuses a stale position instead of writing a wrong invoice', async () => {
    const { jobId, billable } = await jobWithTwoLines();
    const before = await invoiceCount();

    expect(await createInvoiceError({ jobId, services: [{ index: 7, serviceId: billable[0].serviceId }] })).toMatch(/no longer part of this Statement of Work/);
    expect(await createInvoiceError({ jobId, services: [{ index: 0, serviceId: 'not-the-service' }] })).toMatch(/changed while the invoice was being prepared/);
    expect(await invoiceCount()).toBe(before);
  });

  it('still honours the deprecated id contract, one line per entry', async () => {
    const { jobId, billable } = await jobWithTwoLines();

    const data = await gql(ctx, 'staff', `mutation ($input: CreateInvoiceInput!) { createInvoice(input: $input) { subtotal services { cost } } }`, {
      input: { jobId, serviceIds: [billable[0].serviceId, billable[1].serviceId] }
    });

    expect(data.createInvoice.services.map((s: any) => s.cost)).toEqual([100, 250]);
    expect(data.createInvoice.subtotal).toBe(350);
  });
});
