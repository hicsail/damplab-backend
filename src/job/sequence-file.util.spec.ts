import { readFileSync } from 'fs';
import { join } from 'path';
import { extractSequenceRecords, SEQUENCE_FILE_NO_DNA, SEQUENCE_FILE_UNREADABLE } from './sequence-file.util';

const DNA_A = 'ATGGCGCGTACGTAGCTAGCTAGCATCGATCGATCGTAGCTAGCTAGCTAGCATCGATCGG';
const DNA_B = 'TTTACGCGTACGTAGCTAGCTAGCATCGATCGATCGTAGCTAGCTAGCTAGCATCGAAAA';
const PROTEIN = 'MKTAYIAKQRQISFVKSHFSRQLEEPMKTAYIAKQR';
function snapgene(seq: string): Buffer {
  const cookie = Buffer.alloc(19);
  cookie[0] = 9;
  cookie.writeUInt32BE(14, 1);
  cookie.write('SnapGene', 5, 'ascii');
  const head = Buffer.alloc(6);
  head[0] = 0;
  head.writeUInt32BE(seq.length + 1, 1);
  return Buffer.concat([cookie, head, Buffer.from(seq, 'ascii')]);
}
const gb = `LOCUS       pX   61 bp    DNA     linear   SYN 01-JAN-2020\nORIGIN\n        1 ${DNA_A.toLowerCase()
  .match(/.{1,10}/g)!
  .join(' ')}\n//\n`;

describe('extractSequenceRecords (biosecurity-tweaks)', () => {
  it('reads every record of a FASTA, named by its header', () =>
    expect(extractSequenceRecords(Buffer.from(`>alpha\n${DNA_A}\n>beta\n${DNA_B}\n>gamma\n${DNA_A}\n`), 'three.fasta')).toEqual({
      records: [
        { name: 'alpha', seq: DNA_A },
        { name: 'beta', seq: DNA_B },
        { name: 'gamma', seq: DNA_A }
      ],
      skipped: 0
    }));
  it('reads GenBank and SnapGene', () => {
    expect(extractSequenceRecords(Buffer.from(gb), 'plasmid.gb')).toMatchObject({ records: [{ name: 'pX' }], skipped: 0 });
    expect(extractSequenceRecords(snapgene(DNA_A), 'construct.dna')).toEqual({ records: [{ name: 'construct', seq: DNA_A }], skipped: 0 });
  });
  it('reads an upper-case extension (Review Focus 1)', () => expect(extractSequenceRecords(snapgene(DNA_A), 'CONSTRUCT.DNA')).toMatchObject({ records: [{ seq: DNA_A }] }));
  it('skips and counts a protein record in a DNA file (behaviour 13)', () =>
    expect(extractSequenceRecords(Buffer.from(`>d\n${DNA_A}\n>p\n${PROTEIN}\n`), 'mixed.fa')).toEqual({
      records: [{ name: 'd', seq: DNA_A }],
      skipped: 1
    }));
  it('keeps DNA with degenerate bases that seqparse types as protein (Review Focus 2)', () => {
    const degenerate = `${DNA_A.slice(0, 30)}R${DNA_A.slice(31)}`;
    expect(extractSequenceRecords(Buffer.from(`>deg\n${degenerate}\n`), 'deg.fasta')).toEqual({
      records: [{ name: 'deg', seq: degenerate }],
      skipped: 0
    });
  });
  it('a file of only protein has no DNA', () => expect(extractSequenceRecords(Buffer.from(`>p1\n${PROTEIN}\n>p2\n${PROTEIN}\n`), 'proteins.fasta')).toEqual({ error: SEQUENCE_FILE_NO_DNA }));
  it('prose, an empty file and a broken .dna are not sequence files', () => {
    expect(extractSequenceRecords(Buffer.from('The quick brown fox jumps over the lazy dog.\nHello world.\n'), 'notes.txt')).toEqual({
      error: SEQUENCE_FILE_UNREADABLE
    });
    expect(extractSequenceRecords(Buffer.from(''), 'empty.fasta')).toEqual({ error: SEQUENCE_FILE_UNREADABLE });
    expect(extractSequenceRecords(Buffer.from('not snapgene'), 'bad.dna')).toEqual({ error: SEQUENCE_FILE_UNREADABLE });
  });
  it('never fetches: an accession ID is answered synchronously as unreadable (behaviour 16)', () => {
    const result = extractSequenceRecords(Buffer.from('NC_011521.1'), 'accession.txt');
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toEqual({ error: SEQUENCE_FILE_UNREADABLE });
  });
  it('imports only the named parseFile export, never the fetching default', () => {
    const source = readFileSync(join(__dirname, 'sequence-file.util.ts'), 'utf8');
    expect(source).toMatch(/import \{[^}]*\bparseFile\b[^}]*\} from 'seqparse'/);
    expect(source).not.toMatch(/import \w+(,|\s+from)\s*.*'seqparse'/);
  });
});
