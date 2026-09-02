import { BadRequestException } from '@nestjs/common';
import { selectServiceLines } from './select-service-lines';

/**
 * Selection is where the duplicate-service mis-bill lived, so it is pinned here
 * as pure logic rather than only through the service that calls it.
 */
const lines = [
  { serviceId: 'a', cost: 10 },
  { serviceId: 'b', cost: 20 },
  { serviceId: 'a', cost: 30 }
];

describe('selectServiceLines — by position', () => {
  it('returns the lines picked, in the order picked', () => {
    expect(
      selectServiceLines(lines, {
        services: [
          { index: 2, serviceId: 'a' },
          { index: 0, serviceId: 'a' }
        ]
      })
    ).toEqual([lines[2], lines[0]]);
  });

  it('keeps two lines that share a service id distinct', () => {
    // The whole point: `a` appears twice at different prices, and both survive.
    expect(
      selectServiceLines(lines, {
        services: [
          { index: 0, serviceId: 'a' },
          { index: 2, serviceId: 'a' }
        ]
      }).map((l) => l.cost)
    ).toEqual([10, 30]);
  });

  it.each([-1, 3, 1.5, Number.NaN])('refuses index %p', (index) => {
    expect(() => selectServiceLines(lines, { services: [{ index: index as number, serviceId: 'a' }] })).toThrow(BadRequestException);
  });

  it('refuses a position whose service id no longer matches', () => {
    expect(() => selectServiceLines(lines, { services: [{ index: 1, serviceId: 'a' }] })).toThrow(/changed while the invoice was being prepared/);
  });

  it('refuses the same position twice, which would bill one line as two', () => {
    expect(() =>
      selectServiceLines(lines, {
        services: [
          { index: 0, serviceId: 'a' },
          { index: 0, serviceId: 'a' }
        ]
      })
    ).toThrow(/selected more than once/);
  });
});

describe('selectServiceLines — the legacy id contract', () => {
  it('consumes one line per entry rather than collapsing onto the last match', () => {
    expect(selectServiceLines(lines, { serviceIds: ['a', 'a'] }).map((l) => l.cost)).toEqual([10, 30]);
  });

  it('falls back to `_id` for lines that carry no serviceId', () => {
    expect(selectServiceLines([{ _id: 'x', cost: 5 }], { serviceIds: ['x'] })).toEqual([{ _id: 'x', cost: 5 }]);
  });

  it('refuses to satisfy more entries than there are lines', () => {
    expect(() => selectServiceLines(lines, { serviceIds: ['a', 'a', 'a'] })).toThrow(/No unbilled service line matching a/);
  });

  it('refuses an id that is not on the document at all', () => {
    expect(() => selectServiceLines(lines, { serviceIds: ['zzz'] })).toThrow(/No unbilled service line matching zzz/);
  });
});

describe('selectServiceLines — which contract was used', () => {
  it.each([
    ['neither', {}],
    ['empty lists', { services: [], serviceIds: [] }],
    ['nulls', { services: null, serviceIds: null }]
  ])('refuses when %s is supplied', (_label, input) => {
    expect(() => selectServiceLines(lines, input)).toThrow(/at least one service/);
  });

  it('refuses both at once rather than silently preferring one', () => {
    expect(() => selectServiceLines(lines, { services: [{ index: 0, serviceId: 'a' }], serviceIds: ['b'] })).toThrow(/not both/);
  });

  it('refuses a SOW with no service lines at all', () => {
    expect(() => selectServiceLines([], { services: [{ index: 0, serviceId: 'a' }] })).toThrow(/no service lines to invoice/);
  });
});
