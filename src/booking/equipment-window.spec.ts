import { isOutsideWindow, readEquipmentBookers, readEquipmentHoursPerWeek, readEquipmentWindow } from './equipment-window';

const formData = [
  { id: '__equipStart', value: '2026-01-05' },
  { id: '__equipEnd', value: '2026-01-09' },
  { id: '__equipOpenEnd', value: false },
  { id: '__equipHoursPerWeek', value: 6 },
  { id: '__equipBookers', value: [' Booker@BU.edu ', 'booker@bu.edu'] }
];

const at = (iso: string): Date => new Date(iso);

describe('reading the reserved parameters', () => {
  it('reads the window, the hours and the bookers', () => {
    expect(readEquipmentWindow(formData)).toEqual({ start: '2026-01-05', end: '2026-01-09', openEnd: false });
    expect(readEquipmentHoursPerWeek(formData)).toBe(6);
    expect(readEquipmentBookers(formData)).toEqual(['booker@bu.edu']);
  });

  it('returns an empty window for a node with no reserved parameters', () => {
    expect(readEquipmentWindow([{ id: 'other', value: 'x' }])).toEqual({ start: undefined, end: undefined, openEnd: false });
    expect(readEquipmentHoursPerWeek([])).toBeUndefined();
    expect(readEquipmentBookers([])).toEqual([]);
  });

  it('treats the string "true" as open-ended, like a stored checkbox', () => {
    expect(readEquipmentWindow([{ id: '__equipOpenEnd', value: 'true' }]).openEnd).toBe(true);
  });
});

describe('isOutsideWindow', () => {
  const window = { start: '2026-01-05', end: '2026-01-09', openEnd: false };

  it('is false for a slot inside the window', () => {
    expect(isOutsideWindow(window, at('2026-01-06T10:00:00Z'), at('2026-01-06T12:00:00Z'))).toBe(false);
  });

  it('counts the whole of the end date as inside', () => {
    expect(isOutsideWindow(window, at('2026-01-09T22:00:00Z'), at('2026-01-09T23:30:00Z'))).toBe(false);
  });

  it('is true when the slot starts before the start date', () => {
    expect(isOutsideWindow(window, at('2026-01-04T23:00:00Z'), at('2026-01-05T01:00:00Z'))).toBe(true);
  });

  it('is true when the slot ends after midnight following the end date', () => {
    expect(isOutsideWindow(window, at('2026-01-10T09:00:00Z'), at('2026-01-10T10:00:00Z'))).toBe(true);
  });

  it('ignores the end date entirely when the window is open-ended', () => {
    expect(isOutsideWindow({ ...window, openEnd: true }, at('2026-03-01T09:00:00Z'), at('2026-03-01T10:00:00Z'))).toBe(false);
  });

  it('is never outside a window that was never set', () => {
    expect(isOutsideWindow({ openEnd: false }, at('1999-01-01T00:00:00Z'), at('1999-01-01T01:00:00Z'))).toBe(false);
  });
});
