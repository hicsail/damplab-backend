import { parseFile, Seq } from 'seqparse';

export const SEQUENCE_FILE_UNREADABLE = 'is not a sequence file we can read';
export const SEQUENCE_FILE_NO_DNA = 'has no DNA sequence in it';

export type SequenceFileRecords = { records: { name: string; seq: string }[]; skipped: number } | { error: typeof SEQUENCE_FILE_UNREADABLE | typeof SEQUENCE_FILE_NO_DNA };

const NUCLEOTIDE_RATIO = 0.9;

function isDnaRecord(record: Seq): boolean {
  if (record.type === 'dna' || record.type === 'rna') return true;
  const stripped = record.seq.replace(/\s+/g, '').toUpperCase();
  if (stripped.length === 0) return false;
  let nucleotides = 0;
  for (const ch of stripped) if ('ACGTUN'.includes(ch)) nucleotides++;
  return nucleotides / stripped.length >= NUCLEOTIDE_RATIO;
}

/**
 * Reads the sequence records of an uploaded file, offline and synchronously. Never throws and never
 * fetches (only the named `parseFile` export is used, never seqparse's default export, which
 * resolves accession IDs from NCBI).
 *
 * Contract (mirrored by its twin, `damplab-ui/src/utils/sequenceFile.ts`):
 * 1. The filename's extension is lowercased before it is handed to seqparse.
 * 2. For `.dna` (SnapGene) files the buffer's own ArrayBuffer slice is passed as `source`.
 * 3. A parser exception yields `SEQUENCE_FILE_UNREADABLE`; its message embeds the file and is dropped.
 * 4. Only records with a non-blank `seq` count. A record is DNA when seqparse types it `dna` or
 *    `rna`, or when at least 90% of its whitespace-stripped characters are in ACGTUN (seqparse
 *    types IUPAC-degenerate DNA as `aa`).
 * 5. Returns the DNA records (name trimmed) and `skipped`, the number of non-DNA records.
 * 6. With no DNA record: `SEQUENCE_FILE_UNREADABLE` if there was at least one record and all are
 *    typed `unknown` (prose falls back to one `unknown` record), otherwise `SEQUENCE_FILE_NO_DNA`.
 */
export function extractSequenceRecords(buf: Buffer, filename: string): SequenceFileRecords {
  const fileName = filename.replace(/\.[^./\\]+$/, (e) => e.toLowerCase());
  const options: { fileName: string; source?: ArrayBuffer } = { fileName };
  if (fileName.endsWith('.dna')) {
    options.source = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  let parsed: Seq[];
  try {
    parsed = parseFile(buf.toString('utf8'), options);
  } catch {
    return { error: SEQUENCE_FILE_UNREADABLE };
  }

  const candidates = (Array.isArray(parsed) ? parsed : []).filter((r) => typeof r.seq === 'string' && r.seq.trim() !== '');
  const dna = candidates.filter(isDnaRecord);
  if (dna.length === 0) {
    return { error: candidates.length > 0 && candidates.every((r) => r.type === 'unknown') ? SEQUENCE_FILE_UNREADABLE : SEQUENCE_FILE_NO_DNA };
  }
  return { records: dna.map((r) => ({ name: (r.name ?? '').trim(), seq: r.seq })), skipped: candidates.length - dna.length };
}
