import { Sequence, ScreeningBatch } from './models/securedna-graphql.model';

export function normalizeSequenceForGraphql(seq: Record<string, unknown>): Sequence {
  return {
    id: String(seq.id ?? ''),
    name: (seq.name as string) || '',
    type: (seq.type as Sequence['type']) || 'unknown',
    seq: (seq.seq as string) || '',
    annotations: (seq.annotations as Sequence['annotations']) || [],
    userId: (seq.userId as string) || '',
    created_at: seq.created_at as Date,
    updated_at: seq.updated_at as Date
  };
}

function isPopulatedSequence(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && typeof (value as Record<string, unknown>).seq === 'string' && String((value as Record<string, unknown>).seq).length > 0;
}

/**
 * Job homology slices store the nucleotides on the slice, not a Sequence doc.
 * The screener modal still expects `sequence.seq`, so missing docs are filled
 * in from `originalSeq` rather than returning an empty Sequence.
 */
function sequenceFromSlice(slice: Record<string, unknown>, dates: { created_at?: Date; updated_at?: Date }): Sequence {
  if (isPopulatedSequence(slice.sequence)) {
    return normalizeSequenceForGraphql(slice.sequence);
  }
  const name = String(slice.name ?? '');
  const created_at = dates.created_at ?? new Date();
  const updated_at = dates.updated_at ?? created_at;
  return {
    id: String(slice.recordId ?? name),
    name,
    type: 'dna',
    seq: String(slice.originalSeq ?? ''),
    annotations: [],
    userId: '',
    created_at,
    updated_at
  };
}

export function normalizeScreeningBatchForGraphql(batch: Record<string, unknown>): ScreeningBatch {
  const created_at = (batch.created_at ?? batch.createdAt) as Date;
  const updated_at = (batch.updated_at ?? batch.updatedAt) as Date;
  const sequences = ((batch.sequences as Record<string, unknown>[]) || []).map((slice) => ({
    ...slice,
    recordId: String(slice.recordId ?? slice.name ?? ''),
    sequence: sequenceFromSlice(slice, { created_at, updated_at })
  }));
  return {
    ...batch,
    id: String(batch.id ?? batch._id ?? ''),
    created_at,
    updated_at,
    sequences
  } as ScreeningBatch;
}
