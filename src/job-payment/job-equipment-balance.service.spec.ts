import { JobEquipmentBalanceService } from './job-equipment-balance.service';

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

const build = (bookings: any[], paid = 0): JobEquipmentBalanceService => new JobEquipmentBalanceService({ findByJob: async () => bookings } as any, { paymentsToDate: async () => paid } as any);

describe('JobEquipmentBalanceService.balance', () => {
  it('sums the stored cost of confirmed, non-cancelled bookings', async () => {
    const result = await build([booking(), booking({ _id: 'bk-2', cost: 120 })]).balance('job-1');
    expect(result.chargesToDate).toBe(200);
  });

  it('never recomputes cost from hours x rate — the stored figure is what confirmUsage wrote', async () => {
    // rateSnapshot x actualHours would be 200; the stored cost is what counts.
    const result = await build([booking({ actualHours: 5, rateSnapshot: 40, cost: 80 })]).balance('job-1');
    expect(result.chargesToDate).toBe(80);
  });

  it('ignores cancelled and unconfirmed bookings, and counts the unconfirmed ones', async () => {
    const result = await build([
      booking(),
      booking({ _id: 'bk-2', status: 'CANCELLED', cost: 500 }),
      booking({ _id: 'bk-3', usageConfirmed: false, cost: 300 }),
      booking({ _id: 'bk-4', usageConfirmed: false, cost: 300 })
    ]).balance('job-1');
    expect(result.chargesToDate).toBe(80);
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
    const result = await build([booking()], 30).balance('job-1');
    expect(result).toMatchObject({ chargesToDate: 80, paymentsToDate: 30, balanceDue: 50 });
  });

  it('reports a negative balance as a credit rather than flooring at zero', async () => {
    const result = await build([booking()], 100).balance('job-1');
    expect(result.balanceDue).toBe(-20);
  });

  it('rounds every figure to cents', async () => {
    const result = await build([booking({ cost: 10.005 }), booking({ _id: 'bk-2', cost: 0.001 })], 0.004).balance('job-1');
    expect(result.chargesToDate).toBe(10.01);
  });

  it('reports zeroes for a job with nothing on it', async () => {
    const result = await build([]).balance('job-1');
    expect(result).toEqual({ jobId: 'job-1', chargesToDate: 0, paymentsToDate: 0, balanceDue: 0, confirmedHours: 0, unconfirmedBookings: 0 });
  });
});

describe('JobEquipmentBalanceService.confirmedBookings', () => {
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
