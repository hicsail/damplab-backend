import { isOtherOptionName, isOtherTextEntryId, OTHER_TEXT_SUFFIX, otherLabel, otherOptionIdOf, otherTextEntryId, otherTextParentId, selectsOther } from './other-option.util';

const sampleType = {
  id: 'sample_type',
  type: 'dropdown',
  options: [
    { id: 'bact', name: 'Bacteria' },
    { id: 'oth', name: ' other ' }
  ]
};

describe('the "Other" convention', () => {
  it('keeps the suffix both repos share', () => expect(OTHER_TEXT_SUFFIX).toBe('__otherText'));

  it('builds and recognises the companion entry id', () => {
    expect(otherTextEntryId('sample_type')).toBe('sample_type__otherText');
    expect(isOtherTextEntryId('sample_type__otherText')).toBe(true);
    expect(isOtherTextEntryId('sample_type')).toBe(false);
    expect(isOtherTextEntryId('__otherText')).toBe(false);
    expect(isOtherTextEntryId(7)).toBe(false);
    expect(otherTextParentId('sample_type__otherText')).toBe('sample_type');
  });

  it('matches the option name trimmed and case-insensitively', () => {
    for (const name of ['Other', 'other', ' OTHER ']) expect(isOtherOptionName(name)).toBe(true);
    for (const name of ['Others', 'Other (specify)', '', null]) expect(isOtherOptionName(name)).toBe(false);
  });

  it('finds the Other option on a dropdown only', () => {
    expect(otherOptionIdOf(sampleType)).toBe('oth');
    expect(otherOptionIdOf({ ...sampleType, type: 'string' })).toBeNull();
    expect(otherOptionIdOf({ id: 'x', type: 'dropdown', options: [{ id: 'a', name: 'A' }] })).toBeNull();
    expect(otherOptionIdOf(null)).toBeNull();
  });

  it('knows when a single or multi answer selects Other', () => {
    expect(selectsOther(sampleType, 'oth')).toBe(true);
    expect(selectsOther(sampleType, ['bact', 'oth'])).toBe(true);
    expect(selectsOther(sampleType, 'bact')).toBe(false);
    expect(selectsOther(sampleType, [])).toBe(false);
    expect(selectsOther(sampleType, null)).toBe(false);
  });

  it('labels Other with its text', () => {
    expect(otherLabel('Other', ' Yeast ')).toBe('Other: Yeast');
    expect(otherLabel('other', 'Yeast')).toBe('Other: Yeast');
    expect(otherLabel('Other', '  ')).toBe('Other');
    expect(otherLabel('Other', undefined)).toBe('Other');
    expect(otherLabel('Bacteria', 'Yeast')).toBe('Bacteria');
  });
});
