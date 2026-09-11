import { Logger } from '@nestjs/common';
import { InvoiceService, toInvoiceServiceLine } from './invoice.service';
import { CHARGE_MESSAGES } from '../job-payment/job-charge.service';
import { oneMonthAfter } from './due-schedule';
import { User } from '../auth/user.interface';

/**
 * `createForJob` as a versioned invoice: every call issues a new version that
 * restates the whole job — the countersigned SOW's contracted lines, confirmed
 * equipment use, custom lines, the deposit, the payments and the due dates —
 * and supersedes whatever stood before it.
 *
 * `breakdown` stands in for `JobBalanceService.chargeBreakdown`, whose own spec
 * pins how those figures are computed; this file pins what the invoice does
 * with them.
 */

const staff = { sub: 'staff-sub', email: 'tech@bu.edu', preferred_username: 'tech', realm_access: { roles: ['damplab-staff'] } } as unknown as User;
const client = { sub: 'client-sub', email: 'client@bu.edu', realm_access: { roles: ['internal-customer'] } } as unknown as User;

const pcr = { serviceId: 's1', name: 'PCR', description: '', cost: 350, category: 'Sequencing' };
const day = (iso: string): Date => new Date(`${iso}T12:00:00Z`);
const isoDay = (d: Date): string => new Date(d).toISOString().slice(0, 10);
const brief = (schedule: any[]): Array<[number, string]> => schedule.map((e) => [e.amount, isoDay(e.dueDate)]);

/** A $100 deposit due 2026-09-20, nothing paid — the charge and the figures derived from it, as chargeBreakdown returns them. */
const withDeposit = {
  depositCharge: { _id: 'd1', kind: 'DEPOSIT', label: 'Deposit', amount: 100, dueDate: day('2026-09-20') },
  depositAmount: 100,
  depositDueDate: day('2026-09-20'),
  depositOutstanding: 100
};

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
    payments: [],
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

interface Harness {
  service: InvoiceService;
  created: any[];
  added: any[];
  voided: any[];
  dispatched: any[];
  updates: any[];
  log: string[];
  existing: any[];
}

function harness(opts: Opts = {}): Harness {
  const created: any[] = [];
  const added: any[] = [];
  const voided: any[] = [];
  const dispatched: any[] = [];
  const updates: any[] = [];
  const log: string[] = [];
  const existing = opts.existingInvoices ?? [];

  const invoiceModel: any = {
    countDocuments: () => ({ exec: async (): Promise<number> => existing.length }),
    // Newest standing first, as `findCurrent` sorts; fixtures list oldest first.
    findOne: () => ({ sort: () => ({ exec: async (): Promise<any> => [...existing].reverse().find((inv) => inv.voidedAt == null && inv.supersededAt == null) ?? null }) }),
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
      log.push(`add:${input.kind}`);
      const saved = { _id: `chg-${added.length + 1}`, ...input };
      added.push(saved);
      return saved;
    },
    voidCharge: async (id: string, reason: string) => {
      log.push(`void:${id}`);
      voided.push({ id, reason });
      return {};
    }
  };
  const balances: any = {
    chargeBreakdown: async () => {
      log.push('breakdown');
      return breakdownOf(opts.breakdown);
    }
  };
  const dispatch: any = { dispatch: (input: any) => dispatched.push(input) };

  return {
    service: new InvoiceService(invoiceModel, jobService, sowService, sowVersionService, charges, balances, dispatch),
    created,
    added,
    voided,
    dispatched,
    updates,
    log,
    existing
  };
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
    const due = day('2026-10-01');
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

  it('lists the payments received, oldest first, as the breakdown gives them', async () => {
    const received = day('2026-09-01');
    const { service, created } = harness({
      breakdown: { paymentsToDate: 200, balanceDue: 150, payments: [{ _id: 'pay-1', amount: 200, receivedOn: received, reference: 'Check #1042', note: 'internal' }] }
    });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].payments).toEqual([{ paymentId: 'pay-1', amount: 200, receivedOn: received, reference: 'Check #1042' }]);
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
});

describe('due dates', () => {
  it('asks for the balance a month out when no invoice stands before it', async () => {
    const { service, created } = harness();
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    const expected = isoDay(oneMonthAfter(created[0].invoiceDate));
    expect(brief(created[0].dueSchedule)).toEqual([[350, expected]]);
    expect(isoDay(created[0].dueDate)).toBe(expected);
  });

  it("keeps the standing version's dates and asks for anything more a month out", async () => {
    const existing = [{ _id: 'inv-1', invoiceNumber: '04217-001', dueSchedule: [{ amount: 300, dueDate: day('2026-09-30') }] }];
    const { service, created } = harness({ existingInvoices: existing });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(brief(created[0].dueSchedule)).toEqual([
      [300, '2026-09-30'],
      [50, isoDay(oneMonthAfter(created[0].invoiceDate))]
    ]);
    expect(isoDay(created[0].dueDate)).toBe('2026-09-30');
  });

  it('ignores the dates of a voided invoice', async () => {
    const existing = [{ _id: 'inv-1', invoiceNumber: '04217-001', voidedAt: day('2026-09-05'), dueSchedule: [{ amount: 300, dueDate: day('2026-09-30') }] }];
    const { service, created } = harness({ existingInvoices: existing });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].dueSchedule.map((e: any) => e.amount)).toEqual([350]);
  });

  it('honours due dates that add up to the balance, oldest first', async () => {
    const { service, created } = harness();
    await service.createForJob(
      {
        jobId: 'job-1',
        dueSchedule: [
          { amount: 150, dueDate: day('2026-11-01') },
          { amount: 200, dueDate: day('2026-10-01') }
        ]
      } as any,
      staff
    );
    expect(brief(created[0].dueSchedule)).toEqual([
      [200, '2026-10-01'],
      [150, '2026-11-01']
    ]);
  });

  it('refuses due dates that do not add up, before writing any line', async () => {
    const { service, added, created } = harness();
    await expect(service.createForJob({ jobId: 'job-1', customLines: [{ label: 'Rush fee', amount: 50 }], dueSchedule: [{ amount: 350, dueDate: day('2026-10-01') }] } as any, staff)).rejects.toThrow(
      'The due dates add up to $350.00, but $400.00 is owed.'
    );
    expect(added).toEqual([]);
    expect(created).toEqual([]);
  });

  it('leaves the deposit out of what the due dates cover, and falls due first on the deposit date', async () => {
    const { service, created } = harness({ breakdown: withDeposit });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].dueSchedule.map((e: any) => e.amount)).toEqual([250]);
    expect(isoDay(created[0].dueDate)).toBe('2026-09-20');
  });

  it('takes no due dates once the payments cover everything', async () => {
    const { service, created } = harness({ breakdown: { paymentsToDate: 350, balanceDue: 0 } });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(created[0].dueSchedule).toEqual([]);
    expect(created[0].dueDate).toBeUndefined();
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

  it('announces the version with the balance and each date it is due by', async () => {
    const { service, dispatched } = harness();
    await service.createForJob({ jobId: 'job-1', dueSchedule: [{ amount: 350, dueDate: day('2026-10-15') }] } as any, staff);
    expect(dispatched[0]).toMatchObject({ eventType: 'INVOICE_ISSUED', title: 'Invoice 04217 · v1 issued', jobId: 'job-1' });
    expect(dispatched[0].message).toContain('Balance due: $350.00 — $350.00 by 2026-10-15.');
  });

  it('says nothing is due when the payments already cover it', async () => {
    const { service, dispatched } = harness({ breakdown: { chargesToDate: 350, paymentsToDate: 350, balanceDue: 0 } });
    await service.createForJob({ jobId: 'job-1' } as any, staff);
    expect(dispatched[0].message).toContain('Nothing is due');
  });

  it('names the deposit first while one is outstanding', async () => {
    const { service, dispatched } = harness({ breakdown: withDeposit });
    await service.createForJob({ jobId: 'job-1', dueSchedule: [{ amount: 250, dueDate: day('2026-10-15') }] } as any, staff);
    expect(dispatched[0].message).toContain('Balance due: $350.00 — $100.00 (deposit) by 2026-09-20; $250.00 by 2026-10-15.');
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
        ],
        // 350 + 40 − 25: checked against the job as it will stand.
        dueSchedule: [{ amount: 365, dueDate: day('2026-10-15') }]
      } as any,
      staff
    );
    expect(added).toEqual([
      expect.objectContaining({ jobId: 'job-1', kind: 'CUSTOM', label: 'Rush fee', amount: 40 }),
      expect.objectContaining({ jobId: 'job-1', kind: 'CUSTOM', label: 'Discount', amount: -25, note: 'Goodwill' })
    ]);
    expect(log.slice(-3)).toEqual(['add:CUSTOM', 'add:CUSTOM', 'breakdown']);
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
    const due = day('2026-10-01');
    const { service, added } = harness();
    await service.createForJob({ jobId: 'job-1', deposit: { amount: 500, dueDate: due } } as any, staff);
    expect(added).toEqual([expect.objectContaining({ kind: 'DEPOSIT', label: 'Deposit', amount: 500, dueDate: due })]);
  });

  it('refuses a deposit with no due date, writing nothing', async () => {
    const { service, added } = harness();
    await expect(service.createForJob({ jobId: 'job-1', customLines: [{ label: 'Fee', amount: 5 }], deposit: { amount: 500 } } as any, staff)).rejects.toThrow(CHARGE_MESSAGES.depositDueDateRequired);
    expect(added).toEqual([]);
  });
});

describe('changing the deposit while issuing', () => {
  const current = { _id: 'd1', kind: 'DEPOSIT', label: 'Deposit', amount: 100, dueDate: day('2026-09-20'), addedAt: day('2026-09-01') };

  it('replaces a deposit that differs, voiding the old one before adding the new', async () => {
    const { service, added, voided, log } = harness({ liveCharges: [current] });
    await service.createForJob({ jobId: 'job-1', deposit: { amount: 150, dueDate: day('2026-09-20') } } as any, staff);
    expect(voided).toEqual([{ id: 'd1', reason: 'Replaced while issuing a new invoice version.' }]);
    expect(added).toEqual([expect.objectContaining({ kind: 'DEPOSIT', amount: 150 })]);
    expect(log.indexOf('void:d1')).toBeLessThan(log.indexOf('add:DEPOSIT'));
  });

  it('leaves an unchanged deposit alone', async () => {
    const { service, added, voided } = harness({ liveCharges: [current] });
    await service.createForJob({ jobId: 'job-1', deposit: { amount: 100, dueDate: new Date('2026-09-20T15:00:00Z') } } as any, staff);
    expect(voided).toEqual([]);
    expect(added).toEqual([]);
  });

  it('removes the deposit', async () => {
    const { service, added, voided } = harness({ liveCharges: [current] });
    await service.createForJob({ jobId: 'job-1', removeDeposit: true } as any, staff);
    expect(voided).toEqual([{ id: 'd1', reason: 'Removed while issuing a new invoice version.' }]);
    expect(added).toEqual([]);
  });

  it('refuses changing and removing it at once', async () => {
    const { service, voided } = harness({ liveCharges: [current] });
    await expect(service.createForJob({ jobId: 'job-1', removeDeposit: true, deposit: { amount: 150, dueDate: day('2026-09-20') } } as any, staff)).rejects.toThrow(
      'Either change the deposit or remove it, not both.'
    );
    expect(voided).toEqual([]);
  });
});

describe('previewing a version', () => {
  it('states what issuing would, and writes nothing', async () => {
    const { service, added, voided, created, updates, dispatched } = harness({ liveCharges: [{ _id: 'd1', kind: 'DEPOSIT', label: 'Deposit', amount: 100, dueDate: day('2026-09-20') }] });
    const preview: any = await service.previewForJob({ jobId: 'job-1', customLines: [{ label: 'Rush fee', amount: 40 }], removeDeposit: true } as any, staff);
    expect(preview).toMatchObject({ _id: 'preview', invoiceNumber: '04217-001', versionNumber: 1, subtotal: 390, balanceDue: 390 });
    expect(preview.customLines).toEqual([expect.objectContaining({ chargeId: 'draft-1', label: 'Rush fee', amount: 40 })]);
    expect(preview.deposit).toBeUndefined();
    expect(preview.dueSchedule.map((e: any) => e.amount)).toEqual([390]);
    expect([added, voided, created, updates, dispatched]).toEqual([[], [], [], [], []]);
  });

  it('refuses what issuing would refuse', async () => {
    const { service } = harness();
    await expect(service.previewForJob({ jobId: 'job-1' } as any, client)).rejects.toThrow(/only staff/i);
    await expect(service.previewForJob({ jobId: 'job-1', customLines: [{ label: '', amount: 5 }] } as any, staff)).rejects.toThrow(CHARGE_MESSAGES.labelRequired);
  });
});

describe('reissuing after a payment changes', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('issues nothing when no invoice stands', async () => {
    const { service, created, dispatched } = harness({ existingInvoices: [{ _id: 'inv-1', invoiceNumber: '04217-001', voidedAt: day('2026-09-05') }] });
    expect(await service.reissueAfterPaymentChange('job-1', staff, 'A payment of $25.00 was received.')).toBeNull();
    expect(created).toEqual([]);
    expect(dispatched).toEqual([]);
  });

  it('issues a new version, naming the payment first in the announcement', async () => {
    const existing = [{ _id: 'inv-1', invoiceNumber: '04217-001', dueSchedule: [{ amount: 350, dueDate: day('2026-10-15') }] }];
    const { service, created, dispatched } = harness({ existingInvoices: existing, breakdown: { paymentsToDate: 100, balanceDue: 250 } });
    const reissued: any = await service.reissueAfterPaymentChange('job-1', staff, 'A payment of $100.00 was received.');
    expect(reissued).toMatchObject({ versionNumber: 2 });
    // The payment came off the date it fell due on.
    expect(brief(created[0].dueSchedule)).toEqual([[250, '2026-10-15']]);
    expect(dispatched[0].message.startsWith('A payment of $100.00 was received. Invoice 04217 · v2')).toBe(true);
  });

  it('does not need the recorder to hold the staff role — the payment gate already admitted them', async () => {
    const { service, created } = harness({ existingInvoices: [{ _id: 'inv-1', invoiceNumber: '04217-001' }] });
    await service.reissueAfterPaymentChange('job-1', client, 'A payment of $25.00 was received.');
    expect(created).toHaveLength(1);
  });

  it('never throws — a refusal is logged and the payment stands', async () => {
    const { service, created } = harness({ existingInvoices: [{ _id: 'inv-1', invoiceNumber: '04217-001' }], activeStatus: 'SENT' });
    expect(await service.reissueAfterPaymentChange('job-1', staff, 'A payment of $25.00 was received.')).toBeNull();
    expect(created).toEqual([]);
  });
});
