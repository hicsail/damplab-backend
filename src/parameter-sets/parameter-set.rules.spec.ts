import { BadRequestException } from '@nestjs/common';
import { normalizeSetName, normalizeSetParameters } from './parameter-set.rules';
import { effectiveParameters, setsByIdMap } from '../services/effective-parameters';

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
  it('keeps a samples-spreadsheet template, and the operation using the set gets it', () => {
    const templateFile = { key: 'sample-sheet-templates/abc.xlsx', filename: 'blank.xlsx' };
    const parameters = normalizeSetParameters([{ id: 'sheet', type: 'sampleSheet', templateFile }]);
    expect(parameters).toEqual([{ id: 'sheet', type: 'sampleSheet', templateFile }]);
    const set = { _id: 'set-1', name: 'Samples', parameters };
    expect(effectiveParameters({ parameters: [], parameterSetIds: ['set-1'] }, setsByIdMap([set]))[0]).toMatchObject({ id: 'sheet', type: 'sampleSheet', templateFile });
  });
  it('rejects a non-list', () => expect(() => normalizeSetParameters({})).toThrow('parameters must be a list.'));
  it('rejects a parameter without an id', () => expect(() => normalizeSetParameters([{ name: 'A' }])).toThrow('Parameter 1 has no id.'));
  it('rejects a duplicated id', () => expect(() => normalizeSetParameters([{ id: 'a' }, { id: 'a' }])).toThrow('Parameter id "a" appears twice in this set.'));
  it('rejects an unparseable validation', () =>
    expect(() => normalizeSetParameters([{ id: 'n', name: 'Cycles', type: 'number', validation: '>0 || <5' }])).toThrow('Parameter “Cycles”: “||” is not supported — join rules with &&.'));
  it('rejects checkboxes on a dropdown that does not allow multiple values', () =>
    expect(() => normalizeSetParameters([{ id: 'd', name: 'Type', type: 'dropdown', display: 'checkboxes' }])).toThrow('Parameter “Type”: “checkboxes” needs a dropdown that allows multiple values.'));
  it('keeps a good validation and display', () => {
    const parameters = [
      { id: 'n', name: 'Cycles', type: 'number', validation: '>0' },
      { id: 'd', name: 'Type', type: 'dropdown', allowMultipleValues: true, display: 'checkboxes' }
    ];
    expect(normalizeSetParameters(parameters)).toEqual(parameters);
  });
});
