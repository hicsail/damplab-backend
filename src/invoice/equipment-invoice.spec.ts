import { InvoiceService } from './invoice.service';
import { User } from '../auth/user.interface';

const staff = { sub: 'tech-sub', email: 'tech@bu.edu', preferred_username: 'tech', realm_access: { roles: ['damplab-staff'] } } as unknown as User;

interface Opts {
  existingInvoices?: any[];
  activeStatus?: string | null;
  hasSow?: boolean;
  balance?: any;
  confirmed?: any[];
}

const defaultBalance = { jobId: 'job-1', chargesToDate: 200, paymentsToDate: 50, balanceDue: 150, confirmedHours: 5, unconfirmedBookings: 1 };

const confirmedBooking = (over: any = {}): any => ({
  _id: 'bk-1',
  jobId: 'job-1',
  nodeId: 'node-a',
  inventoryName: 'Bioanalyzer',
  startTime: new Date('2026-03-01T09:00:00Z'),
  endTime: new Date('2026-03-01T11:00:00Z'),
  actualHours: 2,
  rateSnapshot: 40,
  cost: 80,
  usageConfirmedAt: new Date('2026-03-02T10:00:00Z'),
  ...over
});

function harness(opts: Opts = {}): { service: InvoiceService; created: any[]; dispatched: any[] } {
  const created: any[] = [];
  const dispatched: any[] = [];
  const existing = opts.existingInvoices ?? [];

  const invoiceModel: any = {
    countDocuments: () => ({ exec: async (): Promise<number> => existing.length }),
    find: () => ({ exec: async (): Promise<any[]> => existing }),
    findById: () => ({ exec: async (): Promise<any> => null }),
    findOneAndUpdate: () => ({ exec: async (): Promise<any> => null }),
    create: async (doc: any): Promise<any> => {
      const saved = { _id: `inv-${created.length + 1}`, ...doc };
      created.push(saved);
      return saved;
    }
  };

  const jobService: any = { findById: async (id: string) => (id === 'job-1' ? { _id: 'job-1', jobId: '04217', name: 'Test job', customerCategory: 'INTERNAL_CUSTOMERS' } : null) };
  const sowService: any = {
    findByJobId: async () => (opts.hasSow === false ? null : { _id: 'sow-1', clientName: 'Dr Client', clientEmail: 'client@bu.edu', clientAddress: '1 Main St' }),
    // A single billable line, so `createForJob` (exercised by the
    // "createForJob also announces itself" describe block below) has something
    // to select. select-service-lines.ts refuses an empty billing source
    // regardless of what is selected, so an empty stub here would make that
    // describe block unsatisfiable no matter what it picked.
    billableServiceLines: async (): Promise<any[]> => [{ serviceId: 'svc-1', name: 'PCR', description: '', cost: 100, category: 'Sequencing' }]
  };
  const active = opts.activeStatus === null ? null : { versionNumber: 3, status: opts.activeStatus ?? 'FINAL', inputs: { customerCategory: 'INTERNAL_CUSTOMERS', adjustments: [] } };
  const sowVersionService: any = { getActiveVersion: async () => active, listVersions: async (): Promise<any[]> => (active ? [active] : []) };
  const balances: any = {
    balance: async () => opts.balance ?? defaultBalance,
    confirmedBookings: async () => opts.confirmed ?? [confirmedBooking()]
  };
  const dispatch: any = { dispatch: (input: any) => dispatched.push(input) };

  return { service: new InvoiceService(invoiceModel, jobService, sowService, sowVersionService, balances, dispatch), created, dispatched };
}

describe('createEquipmentInvoice — the gates, in order', () => {
  it('refuses a job that does not exist', async () => {
    const { service } = harness();
    await expect(service.createEquipmentInvoice('nope', staff)).rejects.toThrow(/not found/i);
  });

  it('refuses a job with no SOW, in the spec’s words', async () => {
    const { service } = harness({ hasSow: false });
    await expect(service.createEquipmentInvoice('job-1', staff)).rejects.toThrow('Cannot generate an equipment invoice until the Statement of Work is countersigned.');
  });

  it.each([['SENT'], ['SIGNED'], ['DRAFT'], ['CANCELLED']])('refuses while the active version is only %s', async (status) => {
    const { service } = harness({ activeStatus: status });
    await expect(service.createEquipmentInvoice('job-1', staff)).rejects.toThrow('Cannot generate an equipment invoice until the Statement of Work is countersigned.');
  });

  it('refuses when the SOW has been withdrawn and no version is in force', async () => {
    const { service } = harness({ activeStatus: null });
    await expect(service.createEquipmentInvoice('job-1', staff)).rejects.toThrow('Cannot generate an equipment invoice until the Statement of Work is countersigned.');
  });

  it('refuses when there is neither a charge nor a payment to state', async () => {
    const { service } = harness({ balance: { ...defaultBalance, chargesToDate: 0, paymentsToDate: 0, balanceDue: 0 }, confirmed: [] });
    await expect(service.createEquipmentInvoice('job-1', staff)).rejects.toThrow('Nothing to invoice yet: no confirmed equipment usage on this job.');
  });

  it('allows an invoice that states a credit, where a payment arrived before any usage', async () => {
    const { service, created } = harness({ balance: { ...defaultBalance, chargesToDate: 0, paymentsToDate: 100, balanceDue: -100 }, confirmed: [] });
    await service.createEquipmentInvoice('job-1', staff);
    expect(created[0].balanceDue).toBe(-100);
  });
});

describe('createEquipmentInvoice — the document', () => {
  it('is an EQUIPMENT invoice with no SOW lines and no adjustments', async () => {
    const { service, created } = harness();
    await service.createEquipmentInvoice('job-1', staff);
    expect(created[0]).toMatchObject({ kind: 'EQUIPMENT', services: [], adjustments: [] });
  });

  it('takes the next number in the job’s own series, counting the SOW invoices before it', async () => {
    const { service, created } = harness({ existingInvoices: [{ _id: 'a' }, { _id: 'b' }] });
    await service.createEquipmentInvoice('job-1', staff);
    expect(created[0].invoiceNumber).toBe('04217-003');
  });

  it('lists one line per confirmed booking, in slot order', async () => {
    const { service, created } = harness({
      confirmed: [confirmedBooking(), confirmedBooking({ _id: 'bk-2', inventoryName: 'Sequencer', startTime: new Date('2026-03-04T09:00:00Z'), cost: 120 })]
    });
    await service.createEquipmentInvoice('job-1', staff);
    expect(created[0].equipmentLines.map((l: any) => [l.bookingId, l.itemName, l.cost])).toEqual([
      ['bk-1', 'Bioanalyzer', 80],
      ['bk-2', 'Sequencer', 120]
    ]);
  });

  it('carries the hours, the rate and when usage was confirmed onto each line', async () => {
    const { service, created } = harness();
    await service.createEquipmentInvoice('job-1', staff);
    expect(created[0].equipmentLines[0]).toMatchObject({ actualHours: 2, rate: 40, cost: 80 });
    expect(created[0].equipmentLines[0].confirmedAt).toBeInstanceOf(Date);
  });

  it('states charges, payments and balance, with the total being what is owed now', async () => {
    const { service, created } = harness();
    await service.createEquipmentInvoice('job-1', staff);
    expect(created[0]).toMatchObject({ subtotal: 200, paymentsToDate: 50, balanceDue: 150, totalCost: 150 });
  });

  it('bills to the SOW’s contact and records the version in force', async () => {
    const { service, created } = harness();
    await service.createEquipmentInvoice('job-1', staff);
    expect(created[0]).toMatchObject({ billedToName: 'Dr Client', billedToEmail: 'client@bu.edu', sowVersionNumber: 3, createdBy: 'tech@bu.edu' });
  });
});

describe('createEquipmentInvoice — the notification', () => {
  it('tells the job owner the invoice was issued and what is due', async () => {
    const { service, dispatched } = harness();
    await service.createEquipmentInvoice('job-1', staff);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ eventType: 'INVOICE_ISSUED', title: 'Invoice 04217-001 issued', jobId: 'job-1' });
    expect(dispatched[0].message).toContain('$150.00');
  });
});

describe('createForJob also announces itself', () => {
  it('dispatches INVOICE_ISSUED for a SOW invoice', async () => {
    const { service, dispatched } = harness();
    // billableServiceLines returns one line in this harness (see harness()
    // above); select it by position so createForJob actually creates an
    // invoice, then assert only the dispatch.
    await service.createForJob({ jobId: 'job-1', services: [{ index: 0, serviceId: 'svc-1' }] } as any, staff);
    expect(dispatched[0]).toMatchObject({ eventType: 'INVOICE_ISSUED', title: 'Invoice 04217-001 issued' });
  });
});
