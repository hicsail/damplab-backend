import { InvoiceService } from './invoice.service';
import { User } from '../auth/user.interface';

/**
 * Voiding an invoice.
 *
 * It keeps the document — numbering is derived from a count, so a delete would
 * recycle the number — and changes nothing else: a statement's service lines
 * live on the job's charge ledger, not on the invoice, so voiding the document
 * does not release them. Releasing them back onto the ledger is a separate act
 * (voiding the underlying JobCharge), which this file does not exercise.
 */

const staff = { realm_access: { roles: ['damplab-staff'] }, email: 'tech@bu.edu' } as unknown as User;

interface HarnessOptions {
  existingInvoices?: any[];
}

function harness(opts: HarnessOptions = {}): { service: InvoiceService; created: any[]; existing: any[]; voidedCharges: any[]; releasedCharges: any[] } {
  const created: any[] = [];
  const existing = opts.existingInvoices ?? [];
  const voidedCharges: any[] = [];
  const releasedCharges: any[] = [];

  const matchesVoidFilter = (inv: any, filter: any): boolean => !Object.prototype.hasOwnProperty.call(filter, 'voidedAt') || inv.voidedAt == null;

  const invoiceModel: any = {
    // Filter-aware, because the two counts differ deliberately: numbering counts
    // every invoice, the jobs-list badge counts only the ones that still stand.
    countDocuments: (filter: any = {}) => ({ exec: async (): Promise<number> => existing.filter((inv) => matchesVoidFilter(inv, filter)).length }),
    find: (filter: any = {}) => ({ exec: async (): Promise<any[]> => existing.filter((inv) => matchesVoidFilter(inv, filter)) }),
    findById: (id: string) => ({ exec: async (): Promise<any> => existing.find((inv) => String(inv._id) === String(id)) ?? null }),
    findOneAndUpdate: (filter: any, update: any) => ({
      exec: async (): Promise<any> => {
        const found = existing.find((inv) => String(inv._id) === String(filter._id) && matchesVoidFilter(inv, filter));
        if (!found) return null;
        Object.assign(found, update.$set);
        return found;
      }
    }),
    create: async (doc: any): Promise<any> => {
      created.push(doc);
      return doc;
    }
  };

  const jobService: any = { findById: async () => ({ _id: 'job-1', jobId: '04217', name: 'Test job' }) };
  // FINAL, because invoicing now requires a countersigned SOW and these tests are
  // about voiding rather than about that gate.
  const version = {
    versionNumber: 1000,
    status: 'FINAL',
    inputs: {
      services: [
        { serviceId: 's1', name: 'PCR', cost: 350 },
        { serviceId: 's2', name: 'Gel', cost: 120 }
      ],
      adjustments: []
    }
  };

  const sowService: any = {
    findByJobId: async () => ({ _id: 'sow-1', clientName: 'Dr Client', clientEmail: 'client@bu.edu' }),
    billableServiceLines: async (): Promise<any[]> => version.inputs.services
  };
  const sowVersionService: any = { getActiveVersion: async () => version, listVersions: async (): Promise<any[]> => [version] };

  const charges: any = {
    liveByJobId: async () => [],
    createServiceLineCharges: async (jobId: string, rows: any[]) => {
      releasedCharges.push(...rows);
      return rows;
    },
    voidCharge: async (id: string, reason: string) => {
      voidedCharges.push({ id, reason });
      return { _id: id };
    }
  };

  const balances: any = {
    chargeBreakdown: async () => ({
      jobId: 'job-1',
      serviceLines: [],
      customLines: [],
      depositLines: [],
      bookings: [],
      adjustments: [],
      prorationFactor: 1,
      chargesToDate: 350,
      paymentsToDate: 0,
      balanceDue: 350,
      confirmedHours: 0,
      unconfirmedBookings: 0
    }),
    confirmedBookings: async () => []
  };
  const dispatch: any = { dispatch: () => undefined };

  return { service: new InvoiceService(invoiceModel, jobService, sowService, sowVersionService, charges, balances, dispatch), created, existing, voidedCharges, releasedCharges };
}

/** An invoice as `createForJob` writes one, reduced to what void reads. */
const priorInvoice = (overrides: any = {}): any => ({
  _id: 'inv-1',
  invoiceNumber: '04217-001',
  sowVersionNumber: 1000,
  services: [{ serviceId: 's1', name: 'PCR', sourceIndex: 0 }],
  ...overrides
});

describe('voidInvoice', () => {
  it('records who voided it, when, and why', async () => {
    const { service, existing } = harness({ existingInvoices: [priorInvoice()] });

    const voided: any = await service.voidInvoice('inv-1', '  Billed the wrong customer  ', staff);

    expect(voided.voidReason).toBe('Billed the wrong customer');
    expect(voided.voidedBy).toBe('tech@bu.edu');
    expect(voided.voidedAt).toBeInstanceOf(Date);
    // The document itself stays — a delete would recycle its invoice number.
    expect(existing).toHaveLength(1);
  });

  it('requires a reason', async () => {
    const { service } = harness({ existingInvoices: [priorInvoice()] });

    await expect(service.voidInvoice('inv-1', '   ', staff)).rejects.toThrow(/reason is required/i);
  });

  it('refuses an invoice that is already void rather than overwriting its reason', async () => {
    const { service } = harness({ existingInvoices: [priorInvoice({ voidedAt: new Date(), voidedBy: 'first@bu.edu', voidReason: 'Original reason' })] });

    await expect(service.voidInvoice('inv-1', 'Second reason', staff)).rejects.toThrow(/already been voided/i);
  });

  it('refuses an invoice that does not exist', async () => {
    const { service } = harness({ existingInvoices: [] });

    await expect(service.voidInvoice('nope', 'Any reason', staff)).rejects.toThrow(/not found/i);
  });

  it('stops counting a voided invoice as billing on the jobs list', async () => {
    const { service } = harness({ existingInvoices: [priorInvoice()] });

    expect(await service.countByJobId('job-1')).toBe(1);
    await service.voidInvoice('inv-1', 'Billed the wrong customer', staff);
    // "Has this job been billed yet" — and it has not.
    expect(await service.countByJobId('job-1')).toBe(0);
  });

  it('keeps the voided invoice inside the numbering sequence', async () => {
    const { service, created } = harness({ existingInvoices: [priorInvoice()] });

    await service.voidInvoice('inv-1', 'Billed the wrong customer', staff);
    await service.createForJob({ jobId: 'job-1', releaseServiceLines: [] } as any, staff);

    // -002, not -001: voiding never frees a number, whether or not it releases
    // any charge.
    expect(created[0].invoiceNumber).toBe('04217-002');
  });
});

describe('voiding changes nothing on the charge ledger', () => {
  it('leaves the released service lines exactly where they were', async () => {
    const { service, voidedCharges } = harness({ existingInvoices: [priorInvoice()] });
    await service.voidInvoice('inv-1', 'Billed the wrong customer', staff);
    // Holding a line back is voiding its charge, which is a separate act.
    expect(voidedCharges).toEqual([]);
  });
});
