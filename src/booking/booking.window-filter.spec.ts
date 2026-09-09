import { windowFilter } from './booking.service';

describe('windowFilter', () => {
  const from = new Date('2026-09-07T00:00:00Z');
  const to = new Date('2026-09-14T00:00:00Z');

  it('matches a timed slot that overlaps the window, not only one that starts inside it', () => {
    expect(windowFilter(from, to)).toEqual({
      $or: [{ startTime: { $lte: to }, endTime: { $gte: from } }, { usedOn: { $gte: from, $lte: to } }]
    });
  });

  it('bounds one side only when only one bound is given', () => {
    expect(windowFilter(from, undefined)).toEqual({ $or: [{ endTime: { $gte: from } }, { usedOn: { $gte: from } }] });
    expect(windowFilter(undefined, to)).toEqual({ $or: [{ startTime: { $lte: to } }, { usedOn: { $lte: to } }] });
  });

  it('is empty without bounds', () => {
    expect(windowFilter()).toEqual({});
  });
});
