import { InvoiceService } from './invoice.service';
import { User } from '../auth/user.interface';

/**
 * What an invoice bills from.
 *
 * A SOW version is a static record; `sow.services` is not — the workflow sync
 * overwrites it whenever the job spec changes. Invoicing from the billing core
 * would therefore bill a figure no signed document ever stated, which is the
 * exact failure the static-record rule exists to prevent. Invoices read the
 * version in force with the customer.
 */

const staff = { realm_access: { roles: ['damplab-staff'] }, email: 'tech@bu.edu' } as unknown as User;

interface HarnessOptions {
  /** What the job currently prices these lines at — deliberately different from the document. */
  liveServices?: any[];
  livePricing?: any;
  /** The version in force with the customer, or null for a legacy pre-versioning SOW. */
  activeInputs?: any | null;
}

function harness(opts: HarnessOptions = {}): { service: InvoiceService; created: any[] } {
  const created: any[] = [];

  const invoiceModel: any = {
    countDocuments: () => ({ exec: async (): Promise<number> => 0 }),
    create: async (doc: any): Promise<any> => {
      created.push(doc);
      return doc;
    }
  };

  const jobService: any = { findById: async () => ({ _id: 'job-1', jobId: '04217', name: 'Test job' }) };

  const sowService: any = {
    findByJobId: async () => ({
      _id: 'sow-1',
      services: opts.liveServices ?? [{ serviceId: 's1', name: 'PCR', cost: 420 }],
      pricing: opts.livePricing ?? { baseCost: 420, adjustments: [{ type: 'DISCOUNT', description: 'Later discount', amount: 100 }], totalCost: 320 }
    })
  };

  const sowVersionService: any = {
    getActiveVersion: async () => (opts.activeInputs === null ? null : { inputs: opts.activeInputs ?? { services: [{ serviceId: 's1', name: 'PCR', cost: 350 }], adjustments: [] } })
  };

  return { service: new InvoiceService(invoiceModel, jobService, sowService, sowVersionService), created };
}

describe('invoice billing source', () => {
  it('bills the signed figure, not the job’s current one', async () => {
    const { service, created } = harness();

    await service.createForJob({ jobId: 'job-1', serviceIds: ['s1'] } as any, staff);

    // The job now says $420; the version in force says $350.
    expect(created[0].services[0].cost).toBe(350);
    expect(created[0].subtotal).toBe(350);
  });

  it('does not apply an adjustment the customer never agreed to', async () => {
    const { service, created } = harness();

    await service.createForJob({ jobId: 'job-1', serviceIds: ['s1'] } as any, staff);

    // sow.pricing carries a $100 discount added after the version was issued.
    expect(created[0].adjustments).toEqual([]);
    expect(created[0].totalCost).toBe(350);
  });

  it('applies the adjustments the version in force does carry', async () => {
    const { service, created } = harness({
      activeInputs: { services: [{ serviceId: 's1', name: 'PCR', cost: 350 }], adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 50 }] }
    });

    await service.createForJob({ jobId: 'job-1', serviceIds: ['s1'] } as any, staff);

    expect(created[0].adjustments[0]).toMatchObject({ type: 'DISCOUNT', appliedAmount: -50 });
    expect(created[0].totalCost).toBe(300);
  });

  it('prorates against the version’s base, so a part-invoice takes its share of the discount', async () => {
    const { service, created } = harness({
      activeInputs: {
        services: [
          { serviceId: 's1', name: 'PCR', cost: 300 },
          { serviceId: 's2', name: 'Gel', cost: 100 }
        ],
        adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 40 }]
      }
    });

    await service.createForJob({ jobId: 'job-1', serviceIds: ['s1'] } as any, staff);

    // 300 of a 400 base = 0.75 of the $40 discount.
    expect(created[0].adjustments[0].appliedAmount).toBe(-30);
    expect(created[0].totalCost).toBe(270);
  });

  it('falls back to the billing core for a legacy SOW that has no version at all', async () => {
    const { service, created } = harness({ activeInputs: null });

    await service.createForJob({ jobId: 'job-1', serviceIds: ['s1'] } as any, staff);

    expect(created[0].services[0].cost).toBe(420);
    expect(created[0].adjustments[0]).toMatchObject({ type: 'DISCOUNT', appliedAmount: -100 });
  });

  it('refuses a non-staff caller', async () => {
    const { service } = harness();
    const customer = { realm_access: { roles: [] } } as unknown as User;

    await expect(service.createForJob({ jobId: 'job-1', serviceIds: ['s1'] } as any, customer)).rejects.toThrow();
  });
});
