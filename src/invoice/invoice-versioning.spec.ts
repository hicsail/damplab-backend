import { InvoiceService, toInvoiceServiceLine } from './invoice.service';
import { CHARGE_MESSAGES } from '../job-payment/job-charge.service';
import { User } from '../auth/user.interface';

/**
 * `createForJob` as a versioned invoice: every call issues a new version that
 * restates the whole job — the countersigned SOW's contracted lines, confirmed
 * equipment use, custom lines, the deposit and the payments — and supersedes
 * whatever stood before it.
 *
 * `breakdown` stands in for `JobBalanceService.chargeBreakdown`, whose own spec
 * pins how those figures are computed; this file pins what the invoice does
 * with them.
 */

const staff = { sub: 'staff-sub', email: 'tech@bu.edu', preferred_username: 'tech', realm_access: { roles: ['damplab-staff'] } } as unknown as User;
const client = { sub: 'client-sub', email: 'client@bu.edu', realm_access: { roles: ['internal-customer'] } } as unknown as User;

const pcr = { serviceId: 's1', name: 'PCR', description: '', cost: 350, category: 'Sequencing' };

function breakdownOf(over: any = {}): any {
  return {
    jobId: 'job-1',
    serviceCharges: 350,
    adjustmentCharges: 0,
    equipmentCharges: 0,
    customCharges: 0,
    chargesToDate: 350,
    paymentsToDate: 0,
    balanceDue: 350,
    depositAmount: null,
    depositDueDate: null,
    depositOutstanding: 0,
    confirmedHours: 0,
    unconfirmedBookings: 0,
    serviceLines: [{ line: pcr, sourceIndex: 0 }],
    sowVersionNumber: 1000,
    customLines: [],
    depositCharge: null,
    bookings: [],
    adjustments: [],
    ...over
  };
}

interface Opts {
  existingInvoices?: any[];
  activeStatus?: string | null;
  hasSow?: boolean;
  liveCharges?: any[];
  breakdown?: any;
  versionCategory?: string;
}

function harness(opts: Opts = {}): { service: InvoiceService; created: any[]; added: any[]; dispatched: any[]; updates: any[]; log: string[]; existing: any[] } {
  const created: any[] = [];
  const added: any[] = [];
  const dispatched: any[] = [];
  const updates: any[] = [];
  const log: string[] = [];
  const existing = opts.existingInvoices ?? [];

  const invoiceModel: any = {
    countDocuments: () => ({ exec: async (): Promise<number> => existing.length }),
    create: async (doc: any): Promise<any> => {
      const saved = { _id: `inv-new-${created.length + 1}`, ...doc };
      created.push(saved);
      return saved;
    },
    updateMany: (filter: any, update: any) => ({
      exec: async (): Promise<any> => {
        updates.push({ filter, update });
        for (const inv of existing) if (inv.voidedAt == null && inv.supersededAt == null) Object.assign(inv, update.$set);
        return {};
      }
    })
  };

  const jobService: any = { findById: async (id: string) => (id === 'job-1' ? { _id: 'job-1', jobId: '04217', name: 'Test job', customerCategory: 'INTERNAL_CUSTOMERS' } : null) };
  const sowService: any = {
    findByJobId: async () => (opts.hasSow === false ? null : { _id: 'sow-1', clientName: 'Dr Client', clientEmail: 'client@bu.edu', clientAddress: '1 Main St' })
  };
  const active =
    opts.activeStatus === null ? null : { versionNumber: 1000, status: opts.activeStatus ?? 'FINAL', inputs: { customerCategory: opts.versionCategory ?? 'INTERNAL_CUSTOMERS', adjustments: [] } };
  const sowVersionService: any = { getActiveVersion: async () => active };

  const charges: any = {
    liveByJobId: async () => opts.liveCharges ?? [],
    addCharge: async (input: any) => {
      log.push('add');
      const saved = { _id: `chg-${added.length + 1}`, ...input };
      added.push(saved);
      return saved;
    }
  };
  const balances: any = {
    chargeBreakdown: async () => {
      log.push('breakdown');
      return breakdownOf(opts.breakdown);
    }
  };
  const dispatch: any = { dispatch: (input: any) => dispatched.push(input) };

  return { service: new InvoiceService(invoiceModel, jobService, sowService, sowVersionService, charges, balances, dispatch), created, added, dispatched, updates, log, existing };
}

describe('the countersign gate', () => {
  it('refuses a caller who is not staff', async () => {
    const { service } = harness();
    await expect(service.createForJob({ jobId: 'job-1' } as any, client)).rejects.toThrow(/only staff/i);
  });

  it('refuses a job that does not exist', async () => {
    const { service } = harness();
    await expect(service.createForJob({ jobId: 'nope' } as any, staff)).rejects.toThrow(/not found/i);
  });

  it('refuses a job with no SOW', async () => {
    const { service } = harness({ hasSow: false });
    await expect(service.createForJob({ jobId: 'job-1' } as any, staff)).rejects.toThrow('Cannot generate an invoice until the Statement of Work is countersigned.');
  });

  it.each([['SENT'], ['SIGNED'], ['DRAFT'], ['CANCELLED'], [null]])('refuses while the version in force is %s', async (activeStatus) => {
    const { service, created } = harness({ activeStatus });
    await expect(service.createForJob({ jobId: 'job-1' } as any, staff)).rejects.toThrow(/countersigned/);
    expect(created).toEqual([]);
  });

  it('refuses a deposit before countersignature too, and writes nothing', async () => {
    const { service, added } = harness({ activeStatus: 'SENT' });
    await expect(service.createForJob({ jobId: 'job-1', deposit: { amount: 100, dueDate: new Date('2026-10-01') } } as any, staff)).rejects.toThrow(/countersigned/);
    expect(added).toEqual([]);
  });
});

describe('what a version states', () => {
  it("states the countersigned SOW's contracted lines, with their positions", async () => {
    const { service, created } = harness();
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].services).toEqual([expect.objectContaining({ serviceId: 's1', name: 'PCR', cost: 350, category: 'Sequencing', sourceIndex: 0 })]);
    expect(created[0].sowVersionNumber).toBe(1000);
    expect(created[0].kind).toBe('STATEMENT');
  });

  it('states equipment use, custom lines, the deposit and the totals', async () => {
    const due = new Date('2026-10-01T12:00:00Z');
    const { service, created } = harness({
      breakdown: {
        bookings: [{ _id: 'bk-1', inventoryName: 'GC-MS', notes: 'Job #04217 · TEST', actualHours: 2, rateSnapshot: 40, cost: 80 }],
        customLines: [{ _id: 'c1', kind: 'CUSTOM', label: 'Discount', amount: -50, note: 'Goodwill' }],
        depositCharge: { _id: 'd1', kind: 'DEPOSIT', label: 'Deposit', amount: 100, dueDate: due },
        depositAmount: 100,
        depositDueDate: due,
        depositOutstanding: 100,
        chargesToDate: 380,
        balanceDue: 380
      }
    });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    const invoice = created[0];
    expect(invoice.equipmentLines).toEqual([expect.objectContaining({ bookingId: 'bk-1', itemName: 'GC-MS', actualHours: 2, rate: 40, cost: 80 })]);
    expect(invoice.customLines).toEqual([{ chargeId: 'c1', kind: 'CUSTOM', label: 'Discount', amount: -50, note: 'Goodwill' }]);
    expect(invoice.deposit).toEqual({ chargeId: 'd1', label: 'Deposit', amount: 100, dueDate: due, outstanding: 100 });
    expect(invoice).toMatchObject({ subtotal: 380, paymentsToDate: 0, balanceDue: 380, totalCost: 380 });
  });

  it('asks for the balance, not the charges — what was paid is not asked for twice', async () => {
    const { service, created } = harness({ breakdown: { chargesToDate: 350, paymentsToDate: 200, balanceDue: 150 } });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0]).toMatchObject({ subtotal: 350, paymentsToDate: 200, totalCost: 150 });
  });

  it('carries no deposit block when the job has none', async () => {
    const { service, created } = harness();
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].deposit).toBeUndefined();
  });

  it('records the category the version was countersigned under, not the job’s current one', async () => {
    const { service, created } = harness({ versionCategory: 'EXTERNAL_CUSTOMER_ACADEMIC' });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].customerCategory).toBe('EXTERNAL_CUSTOMER_ACADEMIC');
  });

  it('defaults the due date to 30 days after issue, and honours one that is given', async () => {
    const first = harness();
    await first.service.createForJob({ jobId: 'job-1' } as any, staff);
    const days = (first.created[0].dueDate.getTime() - first.created[0].invoiceDate.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);

    const given = new Date('2026-12-01T12:00:00Z');
    const second = harness();
    await second.service.createForJob({ jobId: 'job-1', dueDate: given } as any, staff);
    expect(second.created[0].dueDate).toEqual(given);
  });
});

describe('the pricing basis a line states', () => {
  it('carries the unit price, multiplier, run count and itemised details off the version', () => {
    const details = [{ label: 'Reads', quantity: 4, unitPrice: 50, total: 200 }];
    const line = toInvoiceServiceLine({ line: { ...pcr, cost: 200, unitCost: 50, multiplier: 4, runCount: 4, pricingDetails: details }, sourceIndex: 2 });
    expect(line).toMatchObject({ unitCost: 50, multiplier: 4, runCount: 4, pricingDetails: details, sourceIndex: 2 });
  });

  it('leaves the breakdown undefined on a legacy line rather than inventing a zero', () => {
    const line = toInvoiceServiceLine({ line: { ...pcr, pricingDetails: [] }, sourceIndex: 0 });
    expect(line.unitCost).toBeUndefined();
    expect(line.multiplier).toBeUndefined();
    expect(line.pricingDetails).toBeUndefined();
  });
});

describe('versions', () => {
  it('numbers the first version 1', async () => {
    const { service, created } = harness();
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0]).toMatchObject({ invoiceNumber: '04217-001', versionNumber: 1 });
  });

  it('numbers after every earlier document, voided and superseded ones included', async () => {
    const existing = [
      { _id: 'inv-1', invoiceNumber: '04217-001', supersededAt: new Date() },
      { _id: 'inv-2', invoiceNumber: '04217-002', voidedAt: new Date() },
      { _id: 'inv-3', invoiceNumber: '04217-003' }
    ];
    const { service, created } = harness({ existingInvoices: existing });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0]).toMatchObject({ invoiceNumber: '04217-004', versionNumber: 4 });
  });

  it('supersedes every earlier invoice that still stands, naming its replacement', async () => {
    const existing = [
      { _id: 'inv-1', invoiceNumber: '04217-001' },
      { _id: 'inv-2', invoiceNumber: '04217-002', voidedAt: new Date('2026-09-01') }
    ];
    const { service, created, updates } = harness({ existingInvoices: existing });
    await service.createForJob({ jobId: 'job-1' } as any, staff);

    expect(existing[0]).toMatchObject({ supersededByNumber: '04217-003' });
    expect((existing[0] as any).supersededAt).toBeInstanceOf(Date);
    // A voided invoice stays voided; it is not also superseded.
    expect((existing[1] as any).supersededAt).toBeUndefined();
    // Never the version just issued.
    expect(updates[0].filter).toMatchObject({ jobId: 'job-1', _id: { $ne: created[0]._id }, voidedAt: null, supersededAt: null });
  });

  it('announces the version with the amount due and its date', async () => {
    const { service, dispatched } = harness();
    await service.createForJob({ jobId: 'job-1', dueDate: new Date('2026-10-15T12:00:00Z') } as any, staff);
    expect(dispatched[0]).toMatchObject({ eventType: 'INVOICE_ISSUED', title: 'Invoice 04217 · v1 issued', jobId: 'job-1' });
    expect(dispatched[0].message).toContain('Amount due: $350.00, by 2026-10-15.');
  });

  it('says nothing is due when the payments already cover it', async () => {
    const { service, dispatched } = harness({ breakdown: { chargesToDate: 350, paymentsToDate: 350, balanceDue: 0 } });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(dispatched[0].message).toContain('Nothing is due');
  });

  it('names the deposit and its date while one is outstanding', async () => {
    const { service, dispatched } = harness({ breakdown: { depositAmount: 100, depositDueDate: new Date('2026-09-20T12:00:00Z'), depositOutstanding: 100 } });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(dispatched[0].message).toContain('A deposit of $100.00 is due by 2026-09-20.');
  });
});

describe('lines added while issuing', () => {
  it('adds each custom line to the job before the invoice reads the job', async () => {
    const { service, added, log } = harness();
    await service.createForJob(
      {
        jobId: 'job-1',
        customLines: [
          { label: '  Rush fee ', amount: 40 },
          { label: 'Discount', amount: -25, note: 'Goodwill' }
        ]
      } as any,
      staff
    );
    expect(added).toEqual([
      expect.objectContaining({ jobId: 'job-1', kind: 'CUSTOM', label: 'Rush fee', amount: 40 }),
      expect.objectContaining({ jobId: 'job-1', kind: 'CUSTOM', label: 'Discount', amount: -25, note: 'Goodwill' })
    ]);
    expect(log).toEqual(['add', 'add', 'breakdown']);
  });

  it('refuses a bad line before writing any of them', async () => {
    const { service, added, created } = harness();
    await expect(
      service.createForJob(
        {
          jobId: 'job-1',
          customLines: [
            { label: 'Fine', amount: 5 },
            { label: 'Zero', amount: 0 }
          ]
        } as any,
        staff
      )
    ).rejects.toThrow(CHARGE_MESSAGES.amountZero);
    expect(added).toEqual([]);
    expect(created).toEqual([]);
  });

  it('adds the deposit with its due date, labelled "Deposit" by default', async () => {
    const due = new Date('2026-10-01T12:00:00Z');
    const { service, added } = harness();
    await service.createForJob({ jobId: 'job-1', deposit: { amount: 500, dueDate: due } } as any, staff);
    expect(added).toEqual([expect.objectContaining({ kind: 'DEPOSIT', label: 'Deposit', amount: 500, dueDate: due })]);
  });

  it('refuses a deposit with no due date, writing nothing', async () => {
    const { service, added } = harness();
    await expect(service.createForJob({ jobId: 'job-1', customLines: [{ label: 'Fee', amount: 5 }], deposit: { amount: 500 } } as any, staff)).rejects.toThrow(CHARGE_MESSAGES.depositDueDateRequired);
    expect(added).toEqual([]);
  });

  it('refuses a second deposit while one stands, writing nothing', async () => {
    const { service, added } = harness({ liveCharges: [{ _id: 'd1', kind: 'DEPOSIT', amount: 100 }] });
    await expect(service.createForJob({ jobId: 'job-1', deposit: { amount: 500, dueDate: new Date() } } as any, staff)).rejects.toThrow(CHARGE_MESSAGES.depositExists);
    expect(added).toEqual([]);
  });
});
