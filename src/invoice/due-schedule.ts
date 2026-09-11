/**
 * An invoice's due dates: what is still owed, split by when it is due.
 *
 * Each entry is money the customer has not paid yet — balance, not charges —
 * and together the entries cover the balance less the deposit, which carries
 * its own date. Pure, so the default staff see in the issue dialog and the one
 * a payment's automatic reissue uses are the same arithmetic.
 */

export interface DueEntry {
  amount: number;
  dueDate: Date;
}

export const DUE_SCHEDULE_MESSAGES = {
  amountNotPositive: 'Each due date needs an amount greater than zero.',
  dateRequired: 'Each amount needs a due date.',
  nothingDue: 'Nothing is owed, so this invoice takes no due dates.',
  sumMismatch: (sum: number, target: number): string => `The due dates add up to ${money(sum)}, but ${money(target)} is owed.`
};

const cents = (n: unknown): number => Math.round((Number(n) || 0) * 100);

function money(n: number): string {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

function validDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `YYYY-MM-DD` in UTC, the same on a server in any timezone. */
function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Oldest date first — the order they fall due, and the order payments settle them. */
export function sortedSchedule(entries: readonly DueEntry[]): DueEntry[] {
  return [...entries].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
}

/** What the due dates must add up to: the balance less what the deposit asks for, never below zero. */
export function scheduleTarget(balanceDue: number, depositOutstanding: number): number {
  return Math.max(0, cents(balanceDue) - cents(depositOutstanding)) / 100;
}

/**
 * Noon UTC on the same day next month, clamped to that month's last day
 * (January 31 → February 28). Noon so the day reads the same in every US
 * timezone.
 */
export function oneMonthAfter(from: Date): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + 1, Math.min(from.getUTCDate(), lastDay), 12));
}

/**
 * The due dates an earlier invoice stated. A version issued before due dates
 * were split carried one `dueDate` for everything but the deposit; that reads
 * as a single entry for what it asked for.
 */
export function scheduleOf(invoice: any): DueEntry[] {
  if (!invoice) return [];
  if (Array.isArray(invoice.dueSchedule)) {
    return sortedSchedule(
      invoice.dueSchedule.map((e: any) => ({ amount: cents(e?.amount) / 100, dueDate: validDate(e?.dueDate) })).filter((e: any): e is DueEntry => e.dueDate !== null && e.amount > 0)
    );
  }
  const due = validDate(invoice.dueDate);
  if (!due) return [];
  const amount = scheduleTarget(Number(invoice.balanceDue ?? invoice.totalCost) || 0, Number(invoice.deposit?.outstanding) || 0);
  return amount > 0 ? [{ amount, dueDate: due }] : [];
}

/**
 * The due dates a new version starts from.
 *
 * With nothing to carry over, the whole target is due a month out. Otherwise
 * the earlier version's dates are kept, and:
 *
 * - `paidSince` — what payments received since that version settled of its
 *   due dates, the deposit's share excluded — comes off the earliest dates
 *   first, the way a payment settles the oldest demand;
 * - then, when less is owed than the dates still ask for — a discount — the
 *   difference comes off the earliest dates too; when more is owed — a new
 *   charge — the difference falls due a month out.
 *
 * Settling payments before comparing is what keeps a payment and a new charge
 * that arrive together apart: the old date keeps what is left of the old
 * demand, and the new charge gets its own date. An entry that reaches zero is
 * dropped.
 */
export function defaultDueSchedule(previous: readonly DueEntry[], target: number, today: Date, paidSince = 0): DueEntry[] {
  const carried = sortedSchedule(previous)
    .map((e) => ({ cents: cents(e.amount), dueDate: new Date(e.dueDate) }))
    .filter((e) => e.cents > 0 && !Number.isNaN(e.dueDate.getTime()));
  const settle = (amountCents: number): void => {
    let left = amountCents;
    for (const entry of carried) {
      if (left <= 0) break;
      const taken = Math.min(entry.cents, left);
      entry.cents -= taken;
      left -= taken;
    }
  };

  // A negative figure is a voided payment; what it adds back arrives through the difference below.
  settle(Math.max(0, cents(paidSince)));
  const excess = carried.reduce((sum, e) => sum + e.cents, 0) - Math.max(0, cents(target));
  if (excess > 0) settle(excess);

  const schedule = carried.filter((e) => e.cents > 0);
  if (excess < 0) {
    const dueDate = oneMonthAfter(today);
    const last = schedule[schedule.length - 1];
    // Two issues on the same day ask for their additions on the same date: one entry, not two.
    if (last && utcDay(last.dueDate) === utcDay(dueDate)) last.cents += -excess;
    else schedule.push({ cents: -excess, dueDate });
  }
  return schedule.map((e) => ({ amount: e.cents / 100, dueDate: e.dueDate }));
}

/** Why these due dates cannot be issued against `target`, or null when they can. */
export function dueScheduleError(entries: ReadonlyArray<{ amount: number; dueDate?: Date | string | null }>, target: number): string | null {
  for (const entry of entries) {
    if (!(cents(entry.amount) > 0)) return DUE_SCHEDULE_MESSAGES.amountNotPositive;
    if (!validDate(entry.dueDate)) return DUE_SCHEDULE_MESSAGES.dateRequired;
  }
  const targetCents = Math.max(0, cents(target));
  if (targetCents === 0) return entries.length > 0 ? DUE_SCHEDULE_MESSAGES.nothingDue : null;
  const sum = entries.reduce((total, e) => total + cents(e.amount), 0);
  return sum === targetCents ? null : DUE_SCHEDULE_MESSAGES.sumMismatch(sum / 100, targetCents / 100);
}
