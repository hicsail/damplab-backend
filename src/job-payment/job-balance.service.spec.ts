import { JobBalanceService } from './job-balance.service';

const hour = 3_600_000;
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

const build = (bookings: any[], opts: { paid?: number; charges?: any[]; sowLines?: any[]; adjustments?: any[]; hasSow?: boolean; activeStatus?: string | null } = {}): JobBalanceService => {
  const status = opts.activeStatus === undefined ? 'FINAL' : opts.activeStatus;
  const active = status === null ? null : { versionNumber: 1000, status, inputs: { services: opts.sowLines, adjustments: opts.adjustments ?? [] } };
  return new JobBalanceService(
    { findByJob: async () => bookings } as any,
    { paymentsToDate: async () => opts.paid ?? 0 } as any,
    { liveByJobId: async () => opts.charges ?? [] } as any,
    {
      findByJobId: async () => (opts.hasSow === false ? null : { _id: 'sow-1' }),
      billableServiceLines: async () =>
        opts.sowLines ?? [
          { serviceId: 's1', cost: 400 },
          { serviceId: 's2', cost: 600 }
        ]
    } as any,
    { getActiveVersion: async () => active } as any
  );
};

describe('JobBalanceService.balance — equipment charges', () => {
  it('sums the stored cost of confirmed, non-cancelled bookings', async () => {
    const result = await build([booking(), booking({ _id: 'bk-2', cost: 120 })]).balance('job-1');
    expect(result.equipmentCharges).toBe(200);
  });

  it('never recomputes cost from hours x rate — the stored figure is what confirmUsage wrote', async () => {
    // rateSnapshot x actualHours would be 200; the stored cost is what counts.
    const result = await build([booking({ actualHours: 5, rateSnapshot: 40, cost: 80 })]).balance('job-1');
    expect(result.equipmentCharges).toBe(80);
  });

  it('ignores cancelled and unconfirmed bookings, and counts the unconfirmed ones', async () => {
    const result = await build([
      booking(),
      booking({ _id: 'bk-2', status: 'CANCELLED', cost: 500 }),
      booking({ _id: 'bk-3', usageConfirmed: false, cost: 300 }),
      booking({ _id: 'bk-4', usageConfirmed: false, cost: 300 })
    ]).balance('job-1');
    expect(result.equipmentCharges).toBe(80);
    expect(result.unconfirmedBookings).toBe(2);
  });

  it('does not count a cancelled booking as unconfirmed work outstanding', async () => {
    const result = await build([booking({ status: 'CANCELLED', usageConfirmed: false })]).balance('job-1');
    expect(result.unconfirmedBookings).toBe(0);
  });

  it('falls back to the slot length when a confirmed booking carries no actualHours', async () => {
    const result = await build([booking({ actualHours: undefined, startTime: at('2026-03-01T09:00:00Z'), endTime: at('2026-03-01T12:30:00Z') })]).balance('job-1');
    expect(result.confirmedHours).toBe(3.5);
  });

  it('sums confirmed hours across bookings', async () => {
    const result = await build([booking(), booking({ _id: 'bk-2', actualHours: 1.25 })]).balance('job-1');
    expect(result.confirmedHours).toBe(3.25);
  });

  it('subtracts payments and reports the balance due', async () => {
    const result = await build([booking()], { paid: 30 }).balance('job-1');
    expect(result).toMatchObject({ equipmentCharges: 80, paymentsToDate: 30, balanceDue: 50 });
  });

  it('reports a negative balance as a credit rather than flooring at zero', async () => {
    const result = await build([booking()], { paid: 100 }).balance('job-1');
    expect(result.balanceDue).toBe(-20);
  });

  it('rounds every figure to cents', async () => {
    const result = await build([booking({ cost: 10.005 }), booking({ _id: 'bk-2', cost: 0.001 })], { paid: 0.004 }).balance('job-1');
    expect(result.equipmentCharges).toBe(10.01);
  });

  it('reports zeroes for a job with nothing on it', async () => {
    const result = await build([]).balance('job-1');
    expect(result).toEqual({
      jobId: 'job-1',
      serviceCharges: 0,
      adjustmentCharges: 0,
      equipmentCharges: 0,
      customCharges: 0,
      depositCharges: 0,
      depositsDropped: false,
      chargesToDate: 0,
      paymentsToDate: 0,
      balanceDue: 0,
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

describe('the charge ledger', () => {
  it('sums live SERVICE_LINE charges into serviceCharges', async () => {
    const result = await build([], { charges: [charge({ kind: 'SERVICE_LINE', amount: 400, sourceIndex: 0 }), charge({ _id: 'c2', kind: 'SERVICE_LINE', amount: 600, sourceIndex: 1 })] }).balance(
      'job-1'
    );
    expect(result.serviceCharges).toBe(1000);
  });

  it('lets a CUSTOM charge be negative', async () => {
    const result = await build([], { charges: [charge({ amount: -30 })] }).balance('job-1');
    expect(result.customCharges).toBe(-30);
    expect(result.chargesToDate).toBe(-30);
  });

  it('prorates the SOW adjustments by the released share', async () => {
    // 400 of a 1000 SOW released, a $100 discount → -$40 applied.
    const result = await build([], {
      charges: [charge({ kind: 'SERVICE_LINE', amount: 400, sourceIndex: 0 })],
      adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 100 }]
    }).balance('job-1');
    expect(result.adjustmentCharges).toBe(-40);
    expect(result.chargesToDate).toBe(360);
  });

  it('applies no adjustment while nothing has been released', async () => {
    const result = await build([], { adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 100 }] }).balance('job-1');
    expect(result.adjustmentCharges).toBe(0);
  });

  it('applies no adjustment when the job has no SOW at all', async () => {
    const result = await build([], { hasSow: false, charges: [charge({ kind: 'SERVICE_LINE', amount: 400, sourceIndex: 0 })] }).balance('job-1');
    expect(result.adjustmentCharges).toBe(0);
    expect(result.serviceCharges).toBe(400);
  });

  it.each([['SENT'], ['SIGNED'], ['DRAFT'], ['CANCELLED'], [null]])('applies no adjustment when the version in force is %s rather than countersigned', async (activeStatus) => {
    // A withdrawn SOW zeroes the pointer and getActiveVersion answers null. The
    // live billing core is rewritten by every workflow sync, so prorating
    // against it would bill a figure no document ever stated.
    const result = await build([], {
      activeStatus,
      charges: [charge({ kind: 'SERVICE_LINE', amount: 400, sourceIndex: 0 })],
      adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 100 }]
    }).balance('job-1');
    expect(result.adjustmentCharges).toBe(0);
    // The released lines still stand — a withdrawal does not un-charge them.
    expect(result.serviceCharges).toBe(400);
    expect(result.chargesToDate).toBe(400);
  });

  it('ignores voided charges — liveByJobId is what it reads', async () => {
    const result = await build([], { charges: [] }).balance('job-1');
    expect(result.serviceCharges).toBe(0);
    expect(result.customCharges).toBe(0);
  });
});

describe('the deposit drop-off', () => {
  const deposit = charge({ _id: 'dep', kind: 'DEPOSIT', label: 'Deposit', amount: 500 });

  it('counts a deposit while no service line is released', async () => {
    const result = await build([], { charges: [deposit] }).balance('job-1');
    expect(result.depositCharges).toBe(500);
    expect(result.depositsDropped).toBe(false);
    expect(result.chargesToDate).toBe(500);
  });

  it('drops it as soon as one is, and says that it did', async () => {
    const result = await build([], { charges: [deposit, charge({ _id: 'sl', kind: 'SERVICE_LINE', amount: 400, sourceIndex: 0 })] }).balance('job-1');
    expect(result.depositCharges).toBe(0);
    expect(result.depositsDropped).toBe(true);
    // The deposit leaves; the payment made against it stays in paymentsToDate.
    expect(result.chargesToDate).toBe(400);
  });

  it('does not claim a drop-off on a job that has no deposits', async () => {
    const result = await build([], { charges: [charge({ kind: 'SERVICE_LINE', amount: 400, sourceIndex: 0 })] }).balance('job-1');
    expect(result.depositsDropped).toBe(false);
  });

  it('leaves depositLines empty on the breakdown when they are dropped', async () => {
    const breakdown = await build([], { charges: [deposit, charge({ _id: 'sl', kind: 'SERVICE_LINE', amount: 400, sourceIndex: 0 })] }).chargeBreakdown('job-1');
    expect(breakdown.depositLines).toEqual([]);
  });
});

describe('chargeBreakdown', () => {
  it('orders the released service lines by position, whatever order they were added in', async () => {
    const breakdown = await build([], {
      charges: [charge({ _id: 'b', kind: 'SERVICE_LINE', amount: 600, sourceIndex: 1 }), charge({ _id: 'a', kind: 'SERVICE_LINE', amount: 400, sourceIndex: 0 })]
    }).chargeBreakdown('job-1');
    expect(breakdown.serviceLines.map((c: any) => c._id)).toEqual(['a', 'b']);
  });

  it('carries the prorated adjustment rows an invoice writes, at the balance’s own factor', async () => {
    const breakdown = await build([], {
      charges: [charge({ kind: 'SERVICE_LINE', amount: 400, sourceIndex: 0 })],
      adjustments: [{ type: 'DISCOUNT', description: 'Academic', amount: 100 }]
    }).chargeBreakdown('job-1');
    expect(breakdown.prorationFactor).toBe(0.4);
    expect(breakdown.adjustments[0].appliedAmount).toBe(-40);
  });
});

describe('the total and the balance', () => {
  it('sums all five sources and subtracts the payments', async () => {
    const result = await build([booking()], {
      paid: 100,
      charges: [charge({ kind: 'SERVICE_LINE', amount: 400, sourceIndex: 0 }), charge({ _id: 'c', amount: 25 })],
      adjustments: [{ type: 'ADDITIONAL_COST', description: 'Rush', amount: 50 }]
    }).balance('job-1');
    // 400 service + 20 adjustment (50 x 0.4) + 80 equipment + 25 custom + 0 deposit
    expect(result.chargesToDate).toBe(525);
    expect(result.balanceDue).toBe(425);
  });

  it('still reports a credit rather than flooring at zero', async () => {
    const result = await build([], { paid: 200 }).balance('job-1');
    expect(result.balanceDue).toBe(-200);
  });
});
