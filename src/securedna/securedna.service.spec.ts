import { HttpException } from '@nestjs/common';
import { SecureDnaService, assertSynthclientScreenResponse, buildFasta, mapHitsBySequenceId, mapHitsToSlices } from './securedna.service';
import type { ScreeningInputSequence } from './types';

const sequences: ScreeningInputSequence[] = [
  { name: 'wf_n1_insert', seq: 'atg gcg' },
  { name: 'wf_n2_vector', seq: 'TTTT' }
];

describe('buildFasta', () => {
  it('numbers headers by position so a hit can be placed without trusting slice names', () => {
    expect(buildFasta(sequences)).toBe('>s0\nATGGCG\n>s1\nTTTT');
  });
});

describe('mapHitsToSlices', () => {
  it('gives every sequence an empty threat list when nothing was hit', () => {
    expect(mapHitsToSlices(sequences, undefined)).toEqual([[], []]);
    expect(mapHitsToSlices(sequences, [])).toEqual([[], []]);
  });

  it('places a hit on the sequence its header names, not on the first one', () => {
    const hits = mapHitsToSlices(sequences, [{ fasta_header: 's1', hits_by_hazard: ['hazard'] }]);
    expect(hits).toEqual([[], ['hazard']]);
  });

  it('tolerates a header echoed back with its > prefix', () => {
    expect(mapHitsToSlices(sequences, [{ fasta_header: '>s0', hits_by_hazard: ['h'] }])).toEqual([['h'], []]);
  });

  /**
   * A hazard that cannot be placed would vanish from the slice it belongs to,
   * so an unrecognised header falls back to the record's position rather than
   * being dropped.
   */
  it('falls back to position when the header is rewritten', () => {
    const hits = mapHitsToSlices(sequences, [
      { fasta_header: 'renamed-by-synthclient', hits_by_hazard: ['first'] },
      { fasta_header: 'also-renamed', hits_by_hazard: ['second'] }
    ]);
    expect(hits).toEqual([['first'], ['second']]);
  });

  it('ignores a record beyond the sequences we sent', () => {
    expect(mapHitsToSlices(sequences, [{ fasta_header: 'x', hits_by_hazard: ['a'] }, { fasta_header: 'y' }, { fasta_header: 'z', hits_by_hazard: ['c'] }])).toEqual([['a'], []]);
  });
});

describe('assertSynthclientScreenResponse', () => {
  it('accepts either verdict', () => {
    expect(() => assertSynthclientScreenResponse({ synthesis_permission: 'granted' })).not.toThrow();
    expect(() => assertSynthclientScreenResponse({ synthesis_permission: 'denied' })).not.toThrow();
  });

  /**
   * A body we cannot read must never be silently treated as a pass — that is
   * the difference between "screened and cleared" and "never screened".
   */
  it('rejects anything without a verdict', () => {
    expect(() => assertSynthclientScreenResponse({})).toThrow(HttpException);
    expect(() => assertSynthclientScreenResponse({ synthesis_permission: 'maybe' })).toThrow(HttpException);
    expect(() => assertSynthclientScreenResponse(null)).toThrow(HttpException);
    expect(() => assertSynthclientScreenResponse('granted')).toThrow(HttpException);
    expect(() => assertSynthclientScreenResponse([{ synthesis_permission: 'granted' }])).toThrow(HttpException);
  });

  /**
   * Synthclient answers unknown paths with HTTP 200 and
   * `synthesis_permission: "denied"` plus a `not_found` diagnostic. That is a
   * routing miss, not a hazard hit — treating it as a deny would mark a job
   * Failed because of a typo'd SECUREDNA_API_URL.
   */
  it('rejects a not_found body so a wrong path is not a deny', () => {
    expect(() =>
      assertSynthclientScreenResponse({
        synthesis_permission: 'denied',
        errors: [{ diagnostic: 'not_found', additional_info: '/v1/version was not found.' }]
      })
    ).toThrow(HttpException);
  });
});

describe('mapHitsBySequenceId', () => {
  const ids = ['65a1b2c3d4e5f60718293a4b', '65a1b2c3d4e5f60718293a4c'];

  it('places a hit on the sequence whose id was the FASTA header', () => {
    expect(mapHitsBySequenceId(ids, [{ fasta_header: ids[1], hits_by_hazard: ['hazard'] }])).toEqual([[], ['hazard']]);
  });

  it('falls back to position when the header is rewritten', () => {
    expect(
      mapHitsBySequenceId(ids, [
        { fasta_header: 'renamed', hits_by_hazard: ['first'] },
        { fasta_header: 'also-renamed', hits_by_hazard: ['second'] }
      ])
    ).toEqual([['first'], ['second']]);
  });
});

describe('createSequencesBatch', () => {
  const sequenceModel: any = { create: jest.fn() };
  const service = new SecureDnaService({} as any, sequenceModel);

  it('rejects an empty list without writing', async () => {
    await expect(service.createSequencesBatch([], 'user-1')).rejects.toBeInstanceOf(HttpException);
    expect(sequenceModel.create).not.toHaveBeenCalled();
  });

  it('rejects more than the batch ceiling without writing', async () => {
    const tooMany = Array.from({ length: 1001 }, (_, i) => ({ name: `s${i}`, type: 'dna' as const, seq: 'ATGC' }));
    await expect(service.createSequencesBatch(tooMany, 'user-1')).rejects.toBeInstanceOf(HttpException);
    expect(sequenceModel.create).not.toHaveBeenCalled();
  });
});
