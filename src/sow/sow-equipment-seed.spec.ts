import { equipmentSeedPeriods } from './sow-equipment-seed';

/**
 * The opening Period of Performance for a new SOW. The client already gave a
 * Start and End date on each Equipment Use operation; the first draft should
 * say those dates instead of today + 14 days.
 */

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const TODAY = day('2026-10-27');

const equipment = (name: string, start?: string, end?: string): { name: string; formData: unknown } => ({
  name,
  formData: [...(start !== undefined ? [{ id: '__equipStart', value: start }] : []), ...(end !== undefined ? [{ id: '__equipEnd', value: end }] : []), { id: '__equipHoursPerWeek', value: 6 }]
});
const ordinary = (name: string): { name: string; formData: unknown } => ({ name, formData: [{ id: '__runCount', value: 3 }] });

describe('equipmentSeedPeriods', () => {
  it('opens today for 14 days, unlabelled, when the job has no Equipment Use (13)', () => {
    expect(equipmentSeedPeriods([ordinary('PCR')], TODAY)).toEqual([{ startDate: TODAY, durationDays: 14, label: undefined }]);
    expect(equipmentSeedPeriods([], TODAY)).toEqual([{ startDate: TODAY, durationDays: 14, label: undefined }]);
  });

  it('takes one period per operation from its start and end, inclusive, labelled with its name (10, 12)', () => {
    expect(equipmentSeedPeriods([equipment('Confocal', '2026-11-02', '2026-11-15')], TODAY)).toEqual([{ startDate: day('2026-11-02'), durationDays: 14, label: 'Confocal' }]);
  });

  it('counts a same-day window as one day (10)', () => {
    expect(equipmentSeedPeriods([equipment('Confocal', '2026-11-02', '2026-11-02')], TODAY)[0].durationDays).toBe(1);
  });

  it('ignores ordinary services, even on a job that also has equipment (9)', () => {
    const periods = equipmentSeedPeriods([ordinary('PCR'), equipment('Confocal', '2026-11-02', '2026-11-06'), ordinary('Gel')], TODAY);
    expect(periods).toEqual([{ startDate: day('2026-11-02'), durationDays: 5, label: 'Confocal' }]);
  });

  it('treats an operation with only a valid end as Equipment Use, starting today (9, 10)', () => {
    expect(equipmentSeedPeriods([equipment('Confocal', undefined, '2026-11-05')], TODAY)).toEqual([{ startDate: TODAY, durationDays: 10, label: 'Confocal' }]);
  });

  it('runs 14 days from the start when the end is blank, unparseable, or before the start (10)', () => {
    for (const end of [undefined, '', 'next week', '2026-11-01']) {
      expect(equipmentSeedPeriods([equipment('Confocal', '2026-11-02', end)], TODAY)).toEqual([{ startDate: day('2026-11-02'), durationDays: 14, label: 'Confocal' }]);
    }
  });

  it('does not count an operation whose dates are both unparseable as Equipment Use (9)', () => {
    expect(equipmentSeedPeriods([equipment('Confocal', 'soon', 'later')], TODAY)).toEqual([{ startDate: TODAY, durationDays: 14, label: undefined }]);
  });

  it('never reads __equipOpenEnd (10)', () => {
    const openEnded = {
      name: 'Confocal',
      formData: [
        { id: '__equipStart', value: '2026-11-02' },
        { id: '__equipEnd', value: '2026-11-06' },
        { id: '__equipOpenEnd', value: true }
      ]
    };
    expect(equipmentSeedPeriods([openEnded], TODAY)).toEqual([{ startDate: day('2026-11-02'), durationDays: 5, label: 'Confocal' }]);
  });

  it('keeps two operations with the same window and the same name as two periods (11)', () => {
    // Equipment Use nodes are often all named "Equipment Use". They came from
    // separate operations, so each stays its own period (human, 2026-10-27).
    const periods = equipmentSeedPeriods([equipment('Equipment Use', '2026-11-02', '2026-11-06'), equipment('Equipment Use', '2026-11-02', '2026-11-06')], TODAY);
    expect(periods).toEqual([
      { startDate: day('2026-11-02'), durationDays: 5, label: 'Equipment Use' },
      { startDate: day('2026-11-02'), durationDays: 5, label: 'Equipment Use' }
    ]);
  });

  it('keeps operations with the same window in job order, one period each (11, 12)', () => {
    const periods = equipmentSeedPeriods(
      [equipment('Plate reader', '2026-11-02', '2026-11-06'), equipment('Flow cytometer', '2026-11-20', '2026-11-24'), equipment('Confocal', '2026-11-02', '2026-11-06')],
      TODAY
    );
    expect(periods).toEqual([
      { startDate: day('2026-11-02'), durationDays: 5, label: 'Plate reader' },
      { startDate: day('2026-11-02'), durationDays: 5, label: 'Confocal' },
      { startDate: day('2026-11-20'), durationDays: 5, label: 'Flow cytometer' }
    ]);
  });

  it('orders periods by start, then end, whatever the job order (12)', () => {
    const periods = equipmentSeedPeriods([equipment('Late', '2026-12-01', '2026-12-03'), equipment('Long', '2026-11-02', '2026-11-30'), equipment('Short', '2026-11-02', '2026-11-04')], TODAY);
    expect(periods.map((p) => p.label)).toEqual(['Short', 'Long', 'Late']);
  });

  it('reads formData stored as an object map as well as an entry array', () => {
    const asObject = { name: 'Confocal', formData: { __equipStart: '2026-11-02', __equipEnd: '2026-11-03' } };
    expect(equipmentSeedPeriods([asObject], TODAY)).toEqual([{ startDate: day('2026-11-02'), durationDays: 2, label: 'Confocal' }]);
  });
});
