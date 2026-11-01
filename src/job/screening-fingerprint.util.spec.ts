import { TABLE_PARAM_TYPE } from '../workflow/utils/sample-sheet.util';
import { computeScreeningFingerprint, FlaggedAnswer, flaggedAnswerValue, screeningCustomerDetails } from './screening-fingerprint.util';

const customer = { name: 'Ada', company: 'BU', email: 'a@bu.edu' };
const insert: FlaggedAnswer = { nodeId: 'n1', paramId: 'insert', values: ['ATGC'] };
const vector: FlaggedAnswer = { nodeId: 'n2', paramId: 'vector', values: ['GGCC'] };

describe('screening fingerprint', () => {
  it('is a sha-256 hex digest and stable across calls', () => {
    expect(computeScreeningFingerprint([insert], customer)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeScreeningFingerprint([insert], customer)).toBe(computeScreeningFingerprint([insert], customer));
  });
  it('does not depend on answer order', () => {
    expect(computeScreeningFingerprint([insert, vector], customer)).toBe(computeScreeningFingerprint([vector, insert], customer));
  });
  it('changes with a value, a node, a parameter and each customer detail', () => {
    const base = computeScreeningFingerprint([insert], customer);
    expect(computeScreeningFingerprint([{ ...insert, values: ['TTTT'] }], customer)).not.toBe(base);
    expect(computeScreeningFingerprint([{ ...insert, nodeId: 'n9' }], customer)).not.toBe(base);
    expect(computeScreeningFingerprint([{ ...insert, paramId: 'p9' }], customer)).not.toBe(base);
    for (const change of [{ name: 'Bo' }, { company: 'MIT' }, { email: 'b@bu.edu' }]) {
      expect(computeScreeningFingerprint([insert], { ...customer, ...change })).not.toBe(base);
    }
  });
  it('flaggedAnswerValue: Text is the trimmed strings; blank is no value', () => {
    expect(flaggedAnswerValue('string', '  ATGC ')).toEqual(['ATGC']);
    expect(flaggedAnswerValue('string', ['A', ' ', 'B'])).toEqual(['A', 'B']);
    expect(flaggedAnswerValue('string', '   ')).toEqual([]);
    expect(flaggedAnswerValue('string', undefined)).toEqual([]);
  });
  it('flaggedAnswerValue: Table is file key and filename, never the contents', () => {
    const file = { key: 'workflow-parameters/u/a.csv', filename: 'a.csv', size: 10 };
    expect(flaggedAnswerValue(TABLE_PARAM_TYPE, file)).toEqual([{ key: 'workflow-parameters/u/a.csv', filename: 'a.csv' }]);
    expect(flaggedAnswerValue(TABLE_PARAM_TYPE, [file, null, ''])).toHaveLength(1);
    expect(flaggedAnswerValue(TABLE_PARAM_TYPE, null)).toEqual([]);
  });
  it('a replaced table file changes the answer', () => {
    expect(flaggedAnswerValue(TABLE_PARAM_TYPE, { key: 'workflow-parameters/u/b.csv', filename: 'a.csv' })).not.toEqual(
      flaggedAnswerValue(TABLE_PARAM_TYPE, { key: 'workflow-parameters/u/a.csv', filename: 'a.csv' })
    );
  });
  it('screeningCustomerDetails falls back name → username → email', () => {
    expect(screeningCustomerDetails({ clientDisplayName: 'Ada', username: 'u', email: 'e@x', institute: 'BU' }).name).toBe('Ada');
    expect(screeningCustomerDetails({ clientDisplayName: ' ', username: 'u', email: 'e@x', institute: 'BU' }).name).toBe('u');
    expect(screeningCustomerDetails({ username: '', email: 'e@x', institute: 'BU' }).name).toBe('e@x');
    expect(screeningCustomerDetails({ email: 'e@x', institute: ' BU ' })).toEqual({ name: 'e@x', company: 'BU', email: 'e@x' });
  });
});
