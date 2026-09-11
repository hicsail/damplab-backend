import { defaultDueSchedule } from './due-schedule';

/**
 * The default due dates when payments arrived since the earlier version. They
 * settle that version's earliest dates before anything else is compared, so a
 * payment and a new charge arriving together are kept apart.
 */

const day = (iso: string): Date => new Date(`${iso}T12:00:00Z`);
const TODAY = day('2026-09-10');
const brief = (entries: Array<{ amount: number; dueDate: Date }>): Array<[number, string]> => entries.map((e) => [e.amount, e.dueDate.toISOString().slice(0, 10)]);

describe('defaultDueSchedule with payments received since the earlier version', () => {
  it('keeps the old date for what is left of the old demand, and puts a new charge a month out', () => {
    // The earlier version asked for $214 by 09/30. $208 was paid since, and $43 more was charged: $49 is owed.
    expect(brief(defaultDueSchedule([{ amount: 214, dueDate: day('2026-09-30') }], 49, TODAY, 208))).toEqual([
      [6, '2026-09-30'],
      [43, '2026-10-10']
    ]);
  });

  it('settles the earliest dates first, dropping one it covers', () => {
    const previous = [
      { amount: 100, dueDate: day('2026-09-20') },
      { amount: 200, dueDate: day('2026-10-20') }
    ];
    expect(brief(defaultDueSchedule(previous, 150, TODAY, 150))).toEqual([[150, '2026-10-20']]);
  });

  it('comes to the same as comparing totals when the payment is the only change', () => {
    expect(brief(defaultDueSchedule([{ amount: 300, dueDate: day('2026-09-30') }], 250, TODAY, 50))).toEqual([[250, '2026-09-30']]);
  });

  it('ignores a negative figure — what a voided payment adds back falls due a month out', () => {
    expect(brief(defaultDueSchedule([{ amount: 300, dueDate: day('2026-09-30') }], 350, TODAY, -50))).toEqual([
      [300, '2026-09-30'],
      [50, '2026-10-10']
    ]);
  });
});
