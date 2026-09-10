import { InvoiceService } from './invoice.service';
import { User } from '../auth/user.interface';

/**
 * Voiding an invoice.
 *
 * The double-billing guard added with `sourceIndex` made a mis-generated invoice
 * permanent: its lines could never be billed again, and the guard's own refusal
 * told staff to void the earlier invoice — an action that did not exist. Voiding
 * is that action. It keeps the document (numbering is derived from a count, so a
 * delete would recycle the number) and releases the lines.
 */

const staff = { realm_access: { roles: ['damplab-staff'] }, email: 'tech@bu.edu' } as unknown as User;

interface HarnessOptions {
  existingInvoices?: any[];
  activeVersionNumber?: number;
}

function harness(opts: HarnessOptions = {}): { service: InvoiceService; created: any[]; existing: any[] } {
  const created: any[] = [];
  const existing = opts.existingInvoices ?? [];

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
    versionNumber: opts.activeVersionNumber ?? 1000,
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
    findByJobId: async () => ({ _id: 'sow-1', services: version.inputs.services, pricing: { baseCost: 470, adjustments: [], totalCost: 470 } }),
    billableServiceLines: async (): Promise<any[]> => version.inputs.services
  };
  const sowVersionService: any = { getActiveVersion: async () => version, listVersions: async (): Promise<any[]> => [version] };

  const balances: any = { balance: async () => ({ jobId: 'job-1', chargesToDate: 0, paymentsToDate: 0, balanceDue: 0, confirmedHours: 0, unconfirmedBookings: 0 }), confirmedBookings: async () => [] };
  const dispatch: any = { dispatch: () => undefined };

  return { service: new InvoiceService(invoiceModel, jobService, sowService, sowVersionService, balances, dispatch), created, existing };
}

/** An invoice as `createForJob` writes one, reduced to what the guard reads. */
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
});

describe('voiding releases the invoice’s service lines', () => {
  it('refuses to re-bill a line while the earlier invoice stands', async () => {
    const { service } = harness({ existingInvoices: [priorInvoice()] });

    await expect(service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(/already been invoiced/i);
  });

  it('points staff at the action that now exists', async () => {
    const { service } = harness({ existingInvoices: [priorInvoice()] });

    await expect(service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(/void that invoice to release its lines/i);
  });

  it('bills the line again once that invoice is voided', async () => {
    const { service, created } = harness({ existingInvoices: [priorInvoice()] });

    await service.voidInvoice('inv-1', 'Billed the wrong customer', staff);
    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

    expect(created).toHaveLength(1);
    expect(created[0].services[0].serviceId).toBe('s1');
    expect(created[0].services[0].sourceIndex).toBe(0);
  });

  it('keeps the voided invoice inside the numbering sequence', async () => {
    const { service, created } = harness({ existingInvoices: [priorInvoice()] });

    await service.voidInvoice('inv-1', 'Billed the wrong customer', staff);
    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff);

    // -002, not -001: the void released the line but not the number, so the
    // replacement cannot collide with the invoice it replaces.
    expect(created[0].invoiceNumber).toBe('04217-002');
  });

  it('stops counting a voided invoice as billing on the jobs list', async () => {
    const { service } = harness({ existingInvoices: [priorInvoice()] });

    expect(await service.countByJobId('job-1')).toBe(1);
    await service.voidInvoice('inv-1', 'Billed the wrong customer', staff);
    // "Has this job been billed yet" — and it has not.
    expect(await service.countByJobId('job-1')).toBe(0);
  });

  it('still refuses a line held by a second, live invoice', async () => {
    const { service } = harness({
      existingInvoices: [priorInvoice(), priorInvoice({ _id: 'inv-2', invoiceNumber: '04217-002', services: [{ serviceId: 's1', name: 'PCR', sourceIndex: 0 }] })]
    });

    await service.voidInvoice('inv-1', 'Duplicate', staff);

    await expect(service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 's1' }] } as any, staff)).rejects.toThrow(/already on invoice 04217-002/);
  });

  it('voids an equipment invoice the same way, releasing nothing because it claims no lines', async () => {
    const equipment = { _id: 'inv-eq', invoiceNumber: '04217-001', kind: 'EQUIPMENT', services: [], equipmentLines: [{ bookingId: 'bk-1', cost: 80 }] };
    const { service } = harness({ existingInvoices: [equipment] });

    const voided: any = await service.voidInvoice('inv-eq', 'Issued against the wrong job', staff);

    expect(voided.voidedAt).toBeInstanceOf(Date);
    expect(voided.voidReason).toBe('Issued against the wrong job');
    // No line release to assert, and that is the point: an equipment invoice
    // never took a position out of circulation.
    expect(voided.equipmentLines).toHaveLength(1);
  });
});
