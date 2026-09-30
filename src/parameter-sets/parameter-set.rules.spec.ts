import { BadRequestException } from '@nestjs/common';
import { normalizeSetName, normalizeSetParameters } from './parameter-set.rules';

describe('normalizeSetName', () => {
  it('trims', () => expect(normalizeSetName('  Buffers ')).toBe('Buffers'));
  it('rejects blank', () => expect(() => normalizeSetName('  ')).toThrow('A parameter set needs a name.'));
  it('rejects ";" — the operations sheet separates set names with it (Review Focus 4)', () => {
    expect(() => normalizeSetName('Buffers; salts')).toThrow(BadRequestException);
    expect(() => normalizeSetName('Buffers; salts')).toThrow(/cannot contain ";"/);
  });
});

describe('normalizeSetParameters', () => {
  it('strips paramGroupId and provenance keys', () => {
    expect(normalizeSetParameters([{ id: 'a', name: 'A', paramGroupId: 'g', fromParameterSetId: 'x', fromParameterSetName: 'y' }])).toEqual([{ id: 'a', name: 'A' }]);
  });
  it('rejects a non-list', () => expect(() => normalizeSetParameters({})).toThrow('parameters must be a list.'));
  it('rejects a parameter without an id', () => expect(() => normalizeSetParameters([{ name: 'A' }])).toThrow('Parameter 1 has no id.'));
  it('rejects a duplicated id', () => expect(() => normalizeSetParameters([{ id: 'a' }, { id: 'a' }])).toThrow('Parameter id "a" appears twice in this set.'));
});
