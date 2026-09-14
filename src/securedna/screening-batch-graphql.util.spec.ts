import { normalizeScreeningBatchForGraphql } from './screening-batch-graphql.util';

describe('normalizeScreeningBatchForGraphql', () => {
  it('fills in a Sequence from originalSeq when the slice has no stored sequence', () => {
    const stored = new Date('2026-09-14T12:00:00.000Z');
    const batch = normalizeScreeningBatchForGraphql({
      _id: 'b1',
      batchRunId: 'synthclient-1',
      screeningCompletedAt: stored,
      synthesisPermission: 'granted',
      region: 'all',
      hitsByRecord: [],
      warnings: [],
      errors: [],
      userId: 'tech',
      createdAt: stored,
      updatedAt: stored,
      sequences: [
        {
          name: 'wf_n1_insert',
          order: 0,
          originalSeq: 'ATGCGC',
          threats: [{ type: 'nuc' }]
        }
      ]
    });

    expect(batch.sequences[0].recordId).toBe('wf_n1_insert');
    expect(batch.sequences[0].sequence.name).toBe('wf_n1_insert');
    expect(batch.sequences[0].sequence.seq).toBe('ATGCGC');
    expect(batch.sequences[0].sequence.type).toBe('dna');
    expect(batch.sequences[0].threats).toEqual([{ type: 'nuc' }]);
  });

  it('keeps a populated Sequence when the slice already has one', () => {
    const stored = new Date('2026-09-14T12:00:00.000Z');
    const batch = normalizeScreeningBatchForGraphql({
      id: 'b2',
      created_at: stored,
      updated_at: stored,
      sequences: [
        {
          sequence: {
            id: 'seq-1',
            name: 'stored',
            type: 'rna',
            seq: 'ACGU',
            annotations: [],
            userId: 'u',
            created_at: stored,
            updated_at: stored
          },
          recordId: 'seq-1',
          name: 'stored',
          order: 0,
          originalSeq: 'ACGU',
          threats: []
        }
      ]
    });

    expect(batch.sequences[0].sequence.id).toBe('seq-1');
    expect(batch.sequences[0].sequence.type).toBe('rna');
    expect(batch.sequences[0].sequence.seq).toBe('ACGU');
  });
});
