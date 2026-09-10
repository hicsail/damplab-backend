import { JobPaymentService } from './job-payment.service';
import { User } from '../auth/user.interface';

const staff = { sub: 'tech-sub', email: 'tech@bu.edu', realm_access: { roles: ['damplab-staff'] } } as unknown as User;

const isLive = (row: any, filter: any): boolean => !Object.prototype.hasOwnProperty.call(filter, 'voidedAt') || row.voidedAt == null;

function harness(opts: any[] | { rows?: any[]; job?: any; invoices?: any[] } = [], jobArg: any = { _id: 'job-1', jobId: '04217', name: 'Test job' }): { service: JobPaymentService; rows: any[] } {
  const isArray = Array.isArray(opts);
  const rows: any[] = isArray ? opts : opts.rows ?? [];
  const invoices: any[] = isArray ? [] : opts.invoices ?? [];
  const job = isArray ? jobArg : opts.job ?? jobArg;
  const model: any = {
    find: (filter: any = {}) => ({
      sort: () => ({ exec: async (): Promise<any[]> => rows.filter((r) => r.jobId === filter.jobId && isLive(r, filter)) }),
      exec: async (): Promise<any[]> => rows.filter((r) => r.jobId === filter.jobId && isLive(r, filter))
    }),
    findById: (id: string) => ({ exec: async (): Promise<any> => rows.find((r) => String(r._id) === String(id)) ?? null }),
    findOneAndUpdate: (filter: any, update: any) => ({
      exec: async (): Promise<any> => {
        const found = rows.find((r) => String(r._id) === String(filter._id) && isLive(r, filter));
        if (!found) return null;
        Object.assign(found, update.$set);
        return found;
      }
    }),
    create: async (doc: any): Promise<any> => {
      const saved = { _id: `pay-${rows.length + 1}`, ...doc };
      rows.push(saved);
      return saved;
    }
  };
  const jobService: any = { findById: async (id: string) => (id === 'job-1' ? job : null) };
  const invoiceModel: any = {
    findById: (id: string) => ({ exec: async (): Promise<any> => invoices.find((inv) => String(inv._id) === String(id)) ?? null })
  };
  return { service: new JobPaymentService(model, jobService, invoiceModel), rows };
}

const input = (over: any = {}): any => ({ jobId: 'job-1', amount: 250, receivedOn: new Date('2026-03-01'), ...over });

describe('JobPaymentService.record', () => {
  it('stores the amount, the date, the reference and who recorded it', async () => {
    const { service } = harness();
    const saved: any = await service.record(input({ reference: 'Check #1042', note: 'Mailed' }), staff);
    expect(saved).toMatchObject({ jobId: 'job-1', amount: 250, reference: 'Check #1042', note: 'Mailed', recordedBy: 'tech@bu.edu' });
    expect(saved.recordedAt).toBeInstanceOf(Date);
    expect(saved.voidedAt).toBeUndefined();
  });

  it('refuses a zero or negative amount in the spec’s words', async () => {
    const { service } = harness();
    await expect(service.record(input({ amount: 0 }), staff)).rejects.toThrow('Payment amount must be greater than zero.');
    await expect(service.record(input({ amount: -5 }), staff)).rejects.toThrow('Payment amount must be greater than zero.');
  });

  it('refuses a job that does not exist', async () => {
    const { service } = harness();
    await expect(service.record(input({ jobId: 'nope' }), staff)).rejects.toThrow(/not found/i);
  });

  it('rounds the amount to cents', async () => {
    const { service } = harness();
    const saved: any = await service.record(input({ amount: 10.005 }), staff);
    expect(saved.amount).toBe(10.01);
  });

  it('drops a blank reference and note rather than storing empty strings', async () => {
    const { service } = harness();
    const saved: any = await service.record(input({ reference: '   ', note: '' }), staff);
    expect(saved.reference).toBeUndefined();
    expect(saved.note).toBeUndefined();
  });
});

describe('JobPaymentService.voidPayment', () => {
  const live = (): any => ({ _id: 'pay-1', jobId: 'job-1', amount: 250, receivedOn: new Date('2026-03-01') });

  it('records who voided it, when, and why', async () => {
    const { service, rows } = harness([live()]);
    const voided: any = await service.voidPayment('pay-1', '  Bounced cheque  ', staff);
    expect(voided.voidReason).toBe('Bounced cheque');
    expect(voided.voidedBy).toBe('tech@bu.edu');
    expect(voided.voidedAt).toBeInstanceOf(Date);
    expect(rows).toHaveLength(1);
  });

  it('requires a reason in the spec’s words', async () => {
    const { service } = harness([live()]);
    await expect(service.voidPayment('pay-1', '   ', staff)).rejects.toThrow('A reason is required to void a payment.');
  });

  it('refuses a payment that is already void rather than overwriting its reason', async () => {
    const { service } = harness([{ ...live(), voidedAt: new Date(), voidedBy: 'first@bu.edu', voidReason: 'Original' }]);
    await expect(service.voidPayment('pay-1', 'Second reason', staff)).rejects.toThrow(/already been voided/i);
  });

  it('refuses a payment that does not exist', async () => {
    const { service } = harness([]);
    await expect(service.voidPayment('nope', 'Any reason', staff)).rejects.toThrow(/not found/i);
  });
});

describe('JobPaymentService reads', () => {
  it('lists voided payments alongside live ones — the job page shows them struck through', async () => {
    const { service } = harness([
      { _id: 'pay-1', jobId: 'job-1', amount: 100, receivedOn: new Date('2026-03-01') },
      { _id: 'pay-2', jobId: 'job-1', amount: 50, receivedOn: new Date('2026-03-02'), voidedAt: new Date() }
    ]);
    expect((await service.findByJobId('job-1')).map((p: any) => p._id)).toEqual(['pay-1', 'pay-2']);
  });

  it('sums only the payments that still stand', async () => {
    const { service } = harness([
      { _id: 'pay-1', jobId: 'job-1', amount: 100.5, receivedOn: new Date('2026-03-01') },
      { _id: 'pay-2', jobId: 'job-1', amount: 50, receivedOn: new Date('2026-03-02'), voidedAt: new Date() },
      { _id: 'pay-3', jobId: 'job-1', amount: 0.25, receivedOn: new Date('2026-03-03') }
    ]);
    expect(await service.paymentsToDate('job-1')).toBe(100.75);
  });

  it('reports zero for a job with no payments', async () => {
    const { service } = harness([]);
    expect(await service.paymentsToDate('job-1')).toBe(0);
  });
});

describe('a payment that names an invoice', () => {
  const liveInvoice = { _id: 'inv-1', jobId: 'job-1', invoiceNumber: '04217-002' };

  it('snapshots the invoice number alongside the id', async () => {
    const { service } = harness({ invoices: [liveInvoice] });
    const payment: any = await service.record({ jobId: 'job-1', amount: 100, receivedOn: new Date(), invoiceId: 'inv-1' } as any, staff);
    expect(payment.invoiceId).toBe('inv-1');
    // A snapshot, so a payment row still names its invoice without a second read.
    expect(payment.invoiceNumber).toBe('04217-002');
  });

  it('refuses an invoice that belongs to another job', async () => {
    const { service } = harness({ invoices: [{ ...liveInvoice, jobId: 'job-2' }] });
    await expect(service.record({ jobId: 'job-1', amount: 100, receivedOn: new Date(), invoiceId: 'inv-1' } as any, staff)).rejects.toThrow('That invoice is not on this job.');
  });

  it('refuses an invoice that does not exist, in the same words', async () => {
    const { service } = harness({ invoices: [] });
    await expect(service.record({ jobId: 'job-1', amount: 100, receivedOn: new Date(), invoiceId: 'nope' } as any, staff)).rejects.toThrow('That invoice is not on this job.');
  });

  it('refuses a voided invoice', async () => {
    const { service } = harness({ invoices: [{ ...liveInvoice, voidedAt: new Date() }] });
    await expect(service.record({ jobId: 'job-1', amount: 100, receivedOn: new Date(), invoiceId: 'inv-1' } as any, staff)).rejects.toThrow('That invoice has been voided.');
  });

  it('records a payment that names no invoice exactly as before', async () => {
    const { service } = harness({ invoices: [liveInvoice] });
    const payment: any = await service.record({ jobId: 'job-1', amount: 100, receivedOn: new Date() } as any, staff);
    expect(payment.invoiceId).toBeUndefined();
    expect(payment.invoiceNumber).toBeUndefined();
  });
});
