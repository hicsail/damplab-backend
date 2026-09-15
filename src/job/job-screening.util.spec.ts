import { getFormStringFromEntries, looksLikeNucleotideSequence, normalizeSequenceString } from './job-screening.util';
import { parseScreeningSliceName, screeningSliceName } from './job-screening-name.util';

const DNA = 'ATGGCGCGTACGTAGCTAGCTAGCATCGATCGATCGTAGCTAGCTAGCTAGCATCGATCGG';

describe('normalizeSequenceString', () => {
  it('ignores case and internal whitespace, so a reformatted paste is the same sequence', () => {
    expect(normalizeSequenceString(' atg gcg\ncgt ')).toBe('ATGGCGCGT');
    expect(normalizeSequenceString('ATGGCGCGT')).toBe('ATGGCGCGT');
  });
});

describe('looksLikeNucleotideSequence', () => {
  it('accepts a sequence however it was pasted', () => {
    expect(looksLikeNucleotideSequence(DNA)).toBe(true);
    expect(looksLikeNucleotideSequence(DNA.toLowerCase())).toBe(true);
    expect(looksLikeNucleotideSequence(`${DNA.slice(0, 30)}\n${DNA.slice(30)}`)).toBe(true);
  });

  it('accepts N and U alongside ACGT', () => {
    expect(looksLikeNucleotideSequence('ATGCNNNNATGCATGCATGCATGCATGCAUGC')).toBe(true);
  });

  /**
   * The point of the guard: a note or a placeholder typed into the insert box
   * must not be sent to SecureDNA — or stored — as if it were a customer's DNA.
   */
  it('rejects prose, accessions and short scraps', () => {
    expect(looksLikeNucleotideSequence('Will send the sequence separately by email')).toBe(false);
    expect(looksLikeNucleotideSequence('NM_001301717.2 Homo sapiens')).toBe(false);
    expect(looksLikeNucleotideSequence('TBD')).toBe(false);
    expect(looksLikeNucleotideSequence('')).toBe(false);
    expect(looksLikeNucleotideSequence('ATGC')).toBe(false);
  });

  it('tolerates a stray character in an otherwise clean sequence', () => {
    expect(looksLikeNucleotideSequence(`${DNA}X`)).toBe(true);
  });
});

describe('getFormStringFromEntries', () => {
  it('reads a plain string field', () => {
    expect(getFormStringFromEntries([{ id: 'insert', value: ' ATGC ' }], 'insert')).toBe('ATGC');
  });

  it('takes the first usable entry of a multi-value field', () => {
    expect(getFormStringFromEntries([{ id: 'insert', value: ['', ' ATGC '] }], 'insert')).toBe('ATGC');
  });

  it('is null for an absent, empty or non-textual field', () => {
    expect(getFormStringFromEntries([], 'insert')).toBeNull();
    expect(getFormStringFromEntries([{ id: 'insert', value: '   ' }], 'insert')).toBeNull();
    expect(getFormStringFromEntries([{ id: 'insert', value: null }], 'insert')).toBeNull();
  });
});

describe('screening slice names', () => {
  const workflowId = '65a1b2c3d4e5f60718293a4b';

  it('round-trips a node id that itself contains underscores', () => {
    const name = screeningSliceName(workflowId, 'dndnode_12_3', 'insert');
    expect(parseScreeningSliceName(name)).toEqual({ workflowId, nodeId: 'dndnode_12_3', fieldId: 'insert' });
  });

  it('round-trips both screened fields', () => {
    expect(parseScreeningSliceName(screeningSliceName(workflowId, 'n1', 'vector'))?.fieldId).toBe('vector');
    expect(parseScreeningSliceName(screeningSliceName(workflowId, 'n1', 'insert'))?.fieldId).toBe('insert');
  });

  it('rejects a name that is not a slice name', () => {
    expect(parseScreeningSliceName('nonsense')).toBeNull();
    expect(parseScreeningSliceName(`${workflowId}_n1_antibiotic`)).toBeNull();
  });
});
