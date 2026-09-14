import { DUE_SCHEDULE_MESSAGES, defaultDueSchedule, dueScheduleError, oneMonthAfter, scheduleOf, scheduleTarget } from './due-schedule';

/**
 * The due dates a version asks for. Amounts are what is still owed; together
 * with the deposit's outstanding amount they cover the balance due.
 */

const day = (iso: string): Date => new Date(`${iso}T12:00:00Z`);
const TODAY = day('2026-09-10');
const brief = (entries: Array<{ amount: number; dueDate: Date }>): Array<[number, string]> => entries.map((e) => [e.amount, e.dueDate.toISOString().slice(0, 10)]);

describe('scheduleTarget', () => {
  it('is the balance less what the deposit still asks for', () => {
    expect(scheduleTarget(500, 200)).toBe(300);
  });

  it('is never below zero — a credit, or a deposit covering everything, owes nothing more', () => {
    expect(scheduleTarget(-30, 0)).toBe(0);
    expect(scheduleTarget(100, 100)).toBe(0);
  });

  it('carries no float noise', () => {
    expect(scheduleTarget(0.3, 0.1)).toBe(0.2);
  });
});

describe('oneMonthAfter', () => {
  it('is the same day next month, at noon UTC', () => {
    expect(oneMonthAfter(new Date('2026-09-10T03:00:00Z')).toISOString()).toBe('2026-10-10T12:00:00.000Z');
  });

  it('clamps to the last day of a shorter month', () => {
    expect(oneMonthAfter(day('2026-01-31')).toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('rolls over the year', () => {
    expect(oneMonthAfter(day('2026-12-15')).toISOString().slice(0, 10)).toBe('2027-01-15');
  });
});

describe('defaultDueSchedule', () => {
  it('asks for the whole amount a month out when there is nothing to carry over', () => {
    expect(brief(defaultDueSchedule([], 300, TODAY))).toEqual([[300, '2026-10-10']]);
  });

  it('asks for nothing when nothing is owed', () => {
    expect(defaultDueSchedule([], 0, TODAY)).toEqual([]);
  });

  it('keeps the earlier date and adds what more is owed a month out', () => {
    expect(brief(defaultDueSchedule([{ amount: 300, dueDate: day('2026-09-30') }], 350, TODAY))).toEqual([
      [300, '2026-09-30'],
      [50, '2026-10-10']
    ]);
  });

  it('takes a payment off the earliest date first', () => {
    const previous = [
      { amount: 100, dueDate: day('2026-09-20') },
      { amount: 200, dueDate: day('2026-10-20') }
    ];
    expect(brief(defaultDueSchedule(previous, 250, TODAY))).toEqual([
      [50, '2026-09-20'],
      [200, '2026-10-20']
    ]);
  });

  it('drops a date the payments have covered', () => {
    const previous = [
      { amount: 100, dueDate: day('2026-09-20') },
      { amount: 200, dueDate: day('2026-10-20') }
    ];
    expect(brief(defaultDueSchedule(previous, 150, TODAY))).toEqual([[150, '2026-10-20']]);
  });

  it('empties when the payments cover everything', () => {
    expect(defaultDueSchedule([{ amount: 300, dueDate: day('2026-09-30') }], 0, TODAY)).toEqual([]);
  });

  it('orders what it carries by date, whatever order it was given in', () => {
    const previous = [
      { amount: 200, dueDate: day('2026-10-20') },
      { amount: 100, dueDate: day('2026-09-20') }
    ];
    expect(brief(defaultDueSchedule(previous, 300, TODAY))).toEqual([
      [100, '2026-09-20'],
      [200, '2026-10-20']
    ]);
  });

  it('folds a second addition on the same day into the same date', () => {
    const previous = [
      { amount: 300, dueDate: day('2026-09-30') },
      { amount: 50, dueDate: day('2026-10-10') }
    ];
    expect(brief(defaultDueSchedule(previous, 370, TODAY))).toEqual([
      [300, '2026-09-30'],
      [70, '2026-10-10']
    ]);
  });

  it('works in cents, so thirds of a dollar do not drift', () => {
    const schedule = defaultDueSchedule([{ amount: 33.33, dueDate: day('2026-09-30') }], 100, TODAY);
    expect(schedule.map((e) => e.amount)).toEqual([33.33, 66.67]);
  });
});

describe('scheduleOf', () => {
  it('reads the due dates an invoice stated, oldest first', () => {
    const invoice = {
      dueSchedule: [
        { amount: 200, dueDate: '2026-10-20T12:00:00Z' },
        { amount: 100, dueDate: '2026-09-20T12:00:00Z' }
      ]
    };
    expect(brief(scheduleOf(invoice))).toEqual([
      [100, '2026-09-20'],
      [200, '2026-10-20']
    ]);
  });

  it('reads a version issued before due dates were split as one entry for its balance less the deposit', () => {
    expect(brief(scheduleOf({ dueDate: '2026-09-30T12:00:00Z', balanceDue: 500, deposit: { outstanding: 200 } }))).toEqual([[300, '2026-09-30']]);
  });

  it('prefers the schedule, even an empty one, over the single date', () => {
    expect(scheduleOf({ dueSchedule: [], dueDate: '2026-09-30T12:00:00Z', balanceDue: 500 })).toEqual([]);
  });

  it('is empty for no invoice, and for one with no date at all', () => {
    expect(scheduleOf(null)).toEqual([]);
    expect(scheduleOf({ balanceDue: 500 })).toEqual([]);
  });
});

describe('dueScheduleError', () => {
  const on = (iso: string): Date => day(iso);

  it('accepts dates that add up to what is owed, to the cent', () => {
    expect(
      dueScheduleError(
        [
          { amount: 100.1, dueDate: on('2026-09-20') },
          { amount: 199.9, dueDate: on('2026-10-20') }
        ],
        300
      )
    ).toBeNull();
  });

  it('names both figures when they do not add up', () => {
    expect(dueScheduleError([{ amount: 250, dueDate: on('2026-09-20') }], 300)).toBe('The due dates add up to $250.00, but $300.00 is owed.');
  });

  it('refuses an amount that is not positive, and an entry with no date', () => {
    expect(dueScheduleError([{ amount: 0, dueDate: on('2026-09-20') }], 300)).toBe(DUE_SCHEDULE_MESSAGES.amountNotPositive);
    expect(dueScheduleError([{ amount: 300, dueDate: null }], 300)).toBe(DUE_SCHEDULE_MESSAGES.dateRequired);
  });

  it('takes no dates when nothing is owed', () => {
    expect(dueScheduleError([], 0)).toBeNull();
    expect(dueScheduleError([{ amount: 5, dueDate: on('2026-09-20') }], 0)).toBe(DUE_SCHEDULE_MESSAGES.nothingDue);
  });

  it('refuses an empty schedule when something is owed', () => {
    expect(dueScheduleError([], 300)).toBe('The due dates add up to $0.00, but $300.00 is owed.');
  });
});
