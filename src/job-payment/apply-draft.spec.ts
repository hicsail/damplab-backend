import { applyDraft, depositOutstandingOf } from './job-balance.service';

/**
 * The breakdown as it will stand once an issue's new lines and deposit change
 * are written — what the preview shows and what the due dates are checked
 * against, before anything is written.
 */

const due = new Date('2026-09-20T12:00:00Z');

const base = (over: any = {}): any => ({
  jobId: 'job-1',
  serviceCharges: 300,
  adjustmentCharges: -50,
  equipmentCharges: 100,
  customCharges: 25,
  chargesToDate: 375,
  paymentsToDate: 100,
  balanceDue: 275,
  depositAmount: null,
  depositDueDate: null,
  depositOutstanding: 0,
  confirmedHours: 2,
  unconfirmedBookings: 0,
  serviceLines: [],
  sowVersionNumber: 1000,
  customLines: [{ _id: 'c1', kind: 'CUSTOM', label: 'Courier', amount: 25 }],
  depositCharge: null,
  bookings: [],
  adjustments: [],
  payments: [],
  ...over
});

describe('applyDraft', () => {
  it('adds the new lines after the ones already on the job, and restates the totals', () => {
    const draft = applyDraft(base(), {
      customLines: [
        { label: 'Rush fee', amount: 40 },
        { label: 'Goodwill', amount: -15, note: 'Late start' }
      ]
    });
    expect(draft.customLines.map((c: any) => [c._id, c.label, c.amount])).toEqual([
      ['c1', 'Courier', 25],
      ['draft-1', 'Rush fee', 40],
      ['draft-2', 'Goodwill', -15]
    ]);
    expect(draft).toMatchObject({ customCharges: 50, chargesToDate: 400, paymentsToDate: 100, balanceDue: 300 });
  });

  it('states a new deposit, asking only for what payments have not covered', () => {
    const draft = applyDraft(base(), { deposit: { label: 'Deposit', amount: 150, dueDate: due } });
    expect(draft).toMatchObject({ depositAmount: 150, depositDueDate: due, depositOutstanding: 50 });
    expect(draft.chargesToDate).toBe(375);
  });

  it('removes the deposit', () => {
    const withDeposit = base({ depositCharge: { _id: 'd1', kind: 'DEPOSIT', label: 'Deposit', amount: 200, dueDate: due }, depositAmount: 200, depositDueDate: due, depositOutstanding: 100 });
    expect(applyDraft(withDeposit, { removeDeposit: true })).toMatchObject({ depositCharge: null, depositAmount: null, depositDueDate: null, depositOutstanding: 0 });
  });

  it('keeps the job’s deposit when the draft does not touch it, re-capping it at the new balance', () => {
    const withDeposit = base({ depositCharge: { _id: 'd1', kind: 'DEPOSIT', label: 'Deposit', amount: 500, dueDate: due }, depositAmount: 500, depositDueDate: due, depositOutstanding: 275 });
    const draft = applyDraft(withDeposit, { customLines: [{ label: 'Write-off', amount: -175 }] });
    expect(draft).toMatchObject({ depositAmount: 500, balanceDue: 100, depositOutstanding: 100 });
  });

  it('changes nothing with an empty draft', () => {
    expect(applyDraft(base(), {})).toMatchObject({ customCharges: 25, chargesToDate: 375, balanceDue: 275, depositOutstanding: 0 });
  });
});

describe('depositOutstandingOf', () => {
  it('is the deposit less payments', () => {
    expect(depositOutstandingOf(200, 50, 1000)).toBe(150);
  });

  it('never asks for more than the whole balance', () => {
    expect(depositOutstandingOf(200, 0, 120)).toBe(120);
  });

  it('is zero once payments cover it, and when there is no deposit', () => {
    expect(depositOutstandingOf(200, 250, 1000)).toBe(0);
    expect(depositOutstandingOf(null, 0, 1000)).toBe(0);
  });
});
