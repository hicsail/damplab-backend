import { getFormStringFromEntries, looksLikeNucleotideSequence, normalizeSequenceString, screeningStringsFromValue } from './job-screening.util';
import { columnSlugs, multiValueSliceName, screeningSliceName, tableCellSliceName } from './job-screening-name.util';

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

describe('slice names (biosecurity-update)', () => {
  const wf = '65a1b2c3d4e5f60718293a4b';
  it('builds the three shapes', () => {
    expect(screeningSliceName(wf, 'dndnode_1', 'insert')).toBe(`${wf}_dndnode_1_insert`);
    expect(multiValueSliceName(wf, 'dndnode_1', 'inserts', 2)).toBe(`${wf}_dndnode_1_inserts_v2`);
    expect(tableCellSliceName(wf, 'dndnode_1', 'plate', 12, 'insert')).toBe(`${wf}_dndnode_1_plate_r12_insert`);
  });

  it('slugs headers and de-duplicates them in order', () => {
    expect(columnSlugs(['Insert', 'insert ', 'Vector (5′→3′)', '###', 'A'.repeat(60)])).toEqual(['insert', 'insert-2', 'vector-5-3', 'col', 'a'.repeat(40)]);
  });
});

describe('screeningStringsFromValue', () => {
  it('gives every non-blank string, trimmed', () => {
    expect(screeningStringsFromValue(' ATG ')).toEqual(['ATG']);
    expect(screeningStringsFromValue(['A', ' ', 'B', 3 as any, null])).toEqual(['A', 'B']);
    expect(screeningStringsFromValue(null)).toEqual([]);
    expect(screeningStringsFromValue(7)).toEqual([]);
  });
});
