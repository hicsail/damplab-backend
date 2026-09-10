import { InvoiceService } from './invoice.service';
import { User } from '../auth/user.interface';

/**
 * Voiding the job's current invoice.
 *
 * It keeps the document — numbering is derived from a count, so a delete would
 * recycle the number — and changes nothing else: the job's charges and payments
 * stay, and the next version restates them. A superseded invoice is refused:
 * it is already not payable.
 */

const staff = { realm_access: { roles: ['damplab-staff'] }, email: 'tech@bu.edu' } as unknown as User;

/** Honours the two "still stands" conditions the service filters on. */
const matches = (inv: any, filter: any): boolean =>
  ['voidedAt', 'supersededAt'].every((key) => !Object.prototype.hasOwnProperty.call(filter, key) || inv[key] == null) &&
  (!Object.prototype.hasOwnProperty.call(filter, '_id') || typeof filter._id === 'object' || String(inv._id) === String(filter._id));

function harness(existing: any[] = []): { service: InvoiceService; created: any[]; existing: any[] } {
  const created: any[] = [];

  const invoiceModel: any = {
    // Filter-aware, because the two counts differ deliberately: numbering counts
    // every invoice, the jobs-list badge counts only the one that stands.
    countDocuments: (filter: any = {}) => ({ exec: async (): Promise<number> => existing.filter((inv) => matches(inv, filter)).length }),
    findById: (id: string) => ({ exec: async (): Promise<any> => existing.find((inv) => String(inv._id) === String(id)) ?? null }),
    findOneAndUpdate: (filter: any, update: any) => ({
      exec: async (): Promise<any> => {
        const found = existing.find((inv) => matches(inv, filter));
        if (!found) return null;
        Object.assign(found, update.$set);
        return found;
      }
    }),
    create: async (doc: any): Promise<any> => {
      created.push(doc);
      return doc;
    },
    updateMany: () => ({ exec: async (): Promise<any> => ({}) })
  };

  const jobService: any = { findById: async () => ({ _id: 'job-1', jobId: '04217', name: 'Test job' }) };
  const sowService: any = { findByJobId: async () => ({ _id: 'sow-1', clientName: 'Dr Client', clientEmail: 'client@bu.edu' }) };
  const sowVersionService: any = { getActiveVersion: async () => ({ versionNumber: 1000, status: 'FINAL', inputs: { adjustments: [] } }) };
  const charges: any = { liveByJobId: async () => [], addCharge: async (input: any) => input };
  const balances: any = {
    chargeBreakdown: async () => ({
      jobId: 'job-1',
      chargesToDate: 350,
      paymentsToDate: 0,
      balanceDue: 350,
      depositAmount: null,
      depositDueDate: null,
      depositOutstanding: 0,
      serviceLines: [],
      customLines: [],
      depositCharge: null,
      bookings: [],
      adjustments: []
    })
  };
  const dispatch: any = { dispatch: () => undefined };

  return { service: new InvoiceService(invoiceModel, jobService, sowService, sowVersionService, charges, balances, dispatch), created, existing };
}

const current = (overrides: any = {}): any => ({ _id: 'inv-1', jobId: 'job-1', invoiceNumber: '04217-001', kind: 'STATEMENT', ...overrides });

describe('voidInvoice', () => {
  it('records who voided it, when, and why', async () => {
    const { service, existing } = harness([current()]);

    const voided: any = await service.voidInvoice('inv-1', '  Job was cancelled  ', staff);

    expect(voided.voidReason).toBe('Job was cancelled');
    expect(voided.voidedBy).toBe('tech@bu.edu');
    expect(voided.voidedAt).toBeInstanceOf(Date);
    // The document itself stays — a delete would recycle its invoice number.
    expect(existing).toHaveLength(1);
  });

  it('requires a reason', async () => {
    const { service } = harness([current()]);
    await expect(service.voidInvoice('inv-1', '   ', staff)).rejects.toThrow(/reason is required/i);
  });

  it('refuses an invoice that is already void rather than overwriting its reason', async () => {
    const { service } = harness([current({ voidedAt: new Date(), voidedBy: 'first@bu.edu', voidReason: 'Original reason' })]);
    await expect(service.voidInvoice('inv-1', 'Second reason', staff)).rejects.toThrow(/already been voided/i);
  });

  it('refuses a superseded invoice, naming the version that replaced it', async () => {
    const { service, existing } = harness([current({ supersededAt: new Date(), supersededByNumber: '04217-002' })]);
    await expect(service.voidInvoice('inv-1', 'Any reason', staff)).rejects.toThrow(/superseded by 04217-002/);
    expect(existing[0].voidedAt).toBeUndefined();
  });

  it('refuses an invoice that does not exist', async () => {
    const { service } = harness([]);
    await expect(service.voidInvoice('nope', 'Any reason', staff)).rejects.toThrow(/not found/i);
  });
});

describe('what stands on the jobs list', () => {
  it('stops counting a voided invoice', async () => {
    const { service } = harness([current()]);
    expect(await service.countByJobId('job-1')).toBe(1);
    await service.voidInvoice('inv-1', 'Job was cancelled', staff);
    expect(await service.countByJobId('job-1')).toBe(0);
  });

  it('counts only the current version, however many were issued before it', async () => {
    const { service } = harness([
      current({ _id: 'inv-1', supersededAt: new Date() }),
      current({ _id: 'inv-2', invoiceNumber: '04217-002', supersededAt: new Date() }),
      current({ _id: 'inv-3', invoiceNumber: '04217-003' })
    ]);
    expect(await service.countByJobId('job-1')).toBe(1);
  });

  it('keeps a voided invoice inside the numbering sequence', async () => {
    const { service, created } = harness([current()]);
    await service.voidInvoice('inv-1', 'Job was cancelled', staff);
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    // -002, not -001: voiding never frees a number.
    expect(created[0].invoiceNumber).toBe('04217-002');
  });
});
