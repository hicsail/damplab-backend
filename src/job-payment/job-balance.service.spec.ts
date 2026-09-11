import { JobBalanceService } from './job-balance.service';

const at = (iso: string): Date => new Date(iso);

const booking = (over: any = {}): any => ({
  _id: 'bk-1',
  jobId: 'job-1',
  status: 'COMPLETED',
  usageConfirmed: true,
  startTime: at('2026-03-01T09:00:00Z'),
  endTime: at('2026-03-01T11:00:00Z'),
  actualHours: 2,
  rateSnapshot: 40,
  cost: 80,
  ...over
});

const charge = (over: any = {}): any => ({ _id: 'chg-1', jobId: 'job-1', kind: 'CUSTOM', label: 'Courier', amount: 25, addedAt: at('2026-03-01T00:00:00Z'), ...over });

const EQUIP = 'Plate reader — 10 hrs/wk x 4 wks (estimate; billed on actual hours)';

const build = (bookings: any[], opts: { paid?: number; charges?: any[]; sowLines?: any[]; adjustments?: any[]; hasSow?: boolean; activeStatus?: string | null } = {}): JobBalanceService => {
  const status = opts.activeStatus === undefined ? 'FINAL' : opts.activeStatus;
  const active = status === null ? null : { versionNumber: 1000, status, inputs: { services: opts.sowLines, adjustments: opts.adjustments ?? [] } };
  return new JobBalanceService(
    { findByJob: async () => bookings } as any,
    { livePayments: async () => (opts.paid ? [{ _id: 'pay-1', amount: opts.paid, receivedOn: at('2026-03-02T12:00:00Z') }] : []) } as any,
    { liveByJobId: async () => opts.charges ?? [] } as any,
    {
      findByJobId: async () => (opts.hasSow === false ? null : { _id: 'sow-1' }),
      billableServiceLines: async () =>
        opts.sowLines ?? [
          { serviceId: 's1', name: 'PCR', description: '', cost: 400 },
          { serviceId: 's2', name: 'Gel', description: '', cost: 600 }
        ]
    } as any,
    { getActiveVersion: async () => active } as any
  );
};

/** A job with no SOW, so a test about bookings or charges reads only those. */
const noSow = { hasSow: false };

describe('JobBalanceService.balance — equipment charges', () => {
  it('sums the stored cost of confirmed, non-cancelled bookings', async () => {
    const result = await build([booking(), booking({ _id: 'bk-2', cost: 120 })], noSow).balance('job-1');
    expect(result.equipmentCharges).toBe(200);
  });

  it('never recomputes cost from hours x rate — the stored figure is what confirmUsage wrote', async () => {
    const result = await build([booking({ actualHours: 5, rateSnapshot: 40, cost: 80 })], noSow).balance('job-1');
    expect(result.equipmentCharges).toBe(80);
  });

  it('ignores cancelled and unconfirmed bookings, and counts the unconfirmed ones', async () => {
    const result = await build(
      [booking(), booking({ _id: 'bk-2', status: 'CANCELLED', cost: 500 }), booking({ _id: 'bk-3', usageConfirmed: false, cost: 300 }), booking({ _id: 'bk-4', usageConfirmed: false, cost: 300 })],
      noSow
    ).balance('job-1');
    expect(result.equipmentCharges).toBe(80);
    expect(result.unconfirmedBookings).toBe(2);
  });

  it('does not count a cancelled booking as unconfirmed work outstanding', async () => {
    const result = await build([booking({ status: 'CANCELLED', usageConfirmed: false })], noSow).balance('job-1');
    expect(result.unconfirmedBookings).toBe(0);
  });

  it('falls back to the slot length when a confirmed booking carries no actualHours', async () => {
    const result = await build([booking({ actualHours: undefined, startTime: at('2026-03-01T09:00:00Z'), endTime: at('2026-03-01T12:30:00Z') })], noSow).balance('job-1');
    expect(result.confirmedHours).toBe(3.5);
  });

  it('sums confirmed hours across bookings', async () => {
    const result = await build([booking(), booking({ _id: 'bk-2', actualHours: 1.5 })], noSow).balance('job-1');
    expect(result.confirmedHours).toBe(3.5);
  });

  it('rounds every figure to cents', async () => {
    const result = await build([booking({ cost: 10.005 }), booking({ _id: 'bk-2', cost: 0.001 })], { ...noSow, paid: 0.004 }).balance('job-1');
    expect(result.equipmentCharges).toBe(10.01);
  });

  it('reports zeroes for a job with nothing on it', async () => {
    const result = await build([], noSow).balance('job-1');
    expect(result).toEqual({
      jobId: 'job-1',
      serviceCharges: 0,
      adjustmentCharges: 0,
      equipmentCharges: 0,
      customCharges: 0,
      chargesToDate: 0,
      paymentsToDate: 0,
      balanceDue: 0,
      depositAmount: null,
      depositDueDate: null,
      depositOutstanding: 0,
      confirmedHours: 0,
      unconfirmedBookings: 0
    });
  });
});

describe('JobBalanceService.confirmedBookings', () => {
  it('returns only confirmed, non-cancelled bookings, oldest slot first', async () => {
    const rows = await build([
      booking({ _id: 'bk-late', startTime: at('2026-03-05T09:00:00Z') }),
      booking({ _id: 'bk-cancelled', status: 'CANCELLED' }),
      booking({ _id: 'bk-open', usageConfirmed: false }),
      booking({ _id: 'bk-early', startTime: at('2026-03-01T09:00:00Z') })
    ]).confirmedBookings('job-1');
    expect(rows.map((b: any) => b._id)).toEqual(['bk-early', 'bk-late']);
  });
});

describe('services and adjustments', () => {
  it("bills the countersigned version's contracted lines in full, keeping their positions", async () => {
    const breakdown = await build([]).chargeBreakdown('job-1');
    expect(breakdown.serviceCharges).toBe(1000);
    expect(breakdown.serviceLines.map((s) => s.sourceIndex)).toEqual([0, 1]);
    expect(breakdown.sowVersionNumber).toBe(1000);
  });

  it('leaves equipment estimates out — bookings bill those — without shifting positions', async () => {
    const breakdown = await build([], {
      sowLines: [
        { serviceId: 's1', description: '', cost: 350 },
        { serviceId: 's2', description: EQUIP, cost: 150 },
        { serviceId: 's3', description: '', cost: 50 }
      ]
    }).chargeBreakdown('job-1');
    expect(breakdown.serviceCharges).toBe(400);
    expect(breakdown.serviceLines.map((s) => s.sourceIndex)).toEqual([0, 2]);
  });

  it('applies the adjustments in full: discounts subtract, additional costs add, special terms are notes', async () => {
    const breakdown = await build([], {
      adjustments: [
        { type: 'DISCOUNT', description: 'Academic', amount: 100 },
        { type: 'ADDITIONAL_COST', description: 'Rush', amount: 50 },
        { type: 'SPECIAL_TERM', description: 'Samples returned', amount: 0 }
      ]
    }).chargeBreakdown('job-1');
    expect(breakdown.adjustmentCharges).toBe(-50);
    expect(breakdown.adjustments.map((a) => a.prorationFactor)).toEqual([1, 1, 1]);
    expect(breakdown.chargesToDate).toBe(950);
  });

  it.each([['SENT'], ['SIGNED'], ['DRAFT'], ['CANCELLED'], [null]])('bills no services and no adjustments while the version in force is %s', async (activeStatus) => {
    const breakdown = await build([], { activeStatus, adjustments: [{ type: 'DISCOUNT', amount: 100 }] }).chargeBreakdown('job-1');
    expect(breakdown.serviceCharges).toBe(0);
    expect(breakdown.adjustmentCharges).toBe(0);
    expect(breakdown.serviceLines).toEqual([]);
  });

  it('bills no services when the job has no SOW at all', async () => {
    const result = await build([], noSow).balance('job-1');
    expect(result.serviceCharges).toBe(0);
  });

  it('ignores legacy SERVICE_LINE charges — the SOW is the only source of services now', async () => {
    const result = await build([], { charges: [charge({ kind: 'SERVICE_LINE', amount: 999, sourceIndex: 0 })] }).balance('job-1');
    expect(result.serviceCharges).toBe(1000);
    expect(result.chargesToDate).toBe(1000);
  });
});

describe('custom lines', () => {
  it('sums them, and lets one be a discount', async () => {
    const result = await build([], { ...noSow, charges: [charge({ amount: 40 }), charge({ _id: 'c2', amount: -30 })] }).balance('job-1');
    expect(result.customCharges).toBe(10);
    expect(result.chargesToDate).toBe(10);
  });

  it('lists them in the order they were added', async () => {
    const breakdown = await build([], {
      ...noSow,
      charges: [charge({ _id: 'late', addedAt: at('2026-03-05T00:00:00Z') }), charge({ _id: 'early', addedAt: at('2026-03-01T00:00:00Z') })]
    }).chargeBreakdown('job-1');
    expect(breakdown.customLines.map((c: any) => c._id)).toEqual(['early', 'late']);
  });
});

describe('the deposit', () => {
  const due = at('2026-04-01T12:00:00Z');
  const deposit = (over: any = {}): any => charge({ _id: 'dep', kind: 'DEPOSIT', label: 'Deposit', amount: 300, dueDate: due, ...over });

  it('is part of the total, never added to it', async () => {
    const result = await build([], { charges: [deposit()] }).balance('job-1');
    expect(result.chargesToDate).toBe(1000);
    expect(result).toMatchObject({ depositAmount: 300, depositDueDate: due, depositOutstanding: 300 });
  });

  it('is paid down by the payments, and never goes below zero', async () => {
    expect((await build([], { charges: [deposit()], paid: 100 }).balance('job-1')).depositOutstanding).toBe(200);
    expect((await build([], { charges: [deposit()], paid: 400 }).balance('job-1')).depositOutstanding).toBe(0);
  });

  it('never asks for more than the whole balance', async () => {
    const result = await build([], { sowLines: [{ serviceId: 's1', description: '', cost: 100 }], charges: [deposit()] }).balance('job-1');
    expect(result.balanceDue).toBe(100);
    expect(result.depositOutstanding).toBe(100);
  });

  it('reports none on a job without one', async () => {
    const result = await build([]).balance('job-1');
    expect(result).toMatchObject({ depositAmount: null, depositDueDate: null, depositOutstanding: 0 });
  });

  it('takes the newest when older data carries two', async () => {
    const breakdown = await build([], {
      charges: [deposit({ _id: 'old', amount: 100, addedAt: at('2026-02-01T00:00:00Z') }), deposit({ _id: 'new', amount: 250, addedAt: at('2026-03-01T00:00:00Z') })]
    }).chargeBreakdown('job-1');
    expect((breakdown.depositCharge as any)._id).toBe('new');
    expect(breakdown.depositAmount).toBe(250);
  });
});

describe('the total and the balance', () => {
  it('sums the four sources and subtracts the payments', async () => {
    const result = await build([booking()], {
      paid: 100,
      charges: [charge({ amount: 25 })],
      adjustments: [{ type: 'ADDITIONAL_COST', description: 'Rush', amount: 50 }]
    }).balance('job-1');
    // 1000 services + 50 adjustment + 80 equipment + 25 custom
    expect(result.chargesToDate).toBe(1155);
    expect(result.balanceDue).toBe(1055);
  });

  it('reports a credit rather than flooring at zero', async () => {
    const result = await build([], { ...noSow, paid: 200 }).balance('job-1');
    expect(result.balanceDue).toBe(-200);
  });
});
