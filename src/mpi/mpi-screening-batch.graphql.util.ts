import { Sequence, ScreeningBatch } from './models/mpi.model';

export function normalizeSequenceForGraphql(seq: Record<string, unknown>): Sequence {
  return {
    id: String(seq.id ?? ''),
    name: (seq.name as string) || '',
    type: (seq.type as Sequence['type']) || 'unknown',
    seq: (seq.seq as string) || '',
    annotations: (seq.annotations as Sequence['annotations']) || [],
    userId: (seq.userId as string) || '',
    mpiId: (seq.mpiId as string) || '',
    created_at: seq.created_at as Date,
    updated_at: seq.updated_at as Date
  };
}

export function normalizeScreeningBatchForGraphql(batch: Record<string, unknown>): ScreeningBatch {
  const sequences = ((batch.sequences as Record<string, unknown>[]) || []).map((slice) => ({
    ...slice,
    sequence: normalizeSequenceForGraphql((slice.sequence as Record<string, unknown>) || {})
  }));
  return {
    ...batch,
    sequences
  } as ScreeningBatch;
}
