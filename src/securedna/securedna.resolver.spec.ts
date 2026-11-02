import { SecureDnaResolver } from './securedna.resolver';

const staff: any = { sub: 'staff-1', email: 's@bu.edu', preferred_username: 's', realm_access: { roles: ['damplab-staff'] } };

describe('SecureDnaResolver batch reads (F2)', () => {
  const service = { listScreeningBatches: jest.fn(async () => []), findBatchById: jest.fn(async () => null) };

  it('serves a caller who reached it past the jobs:view-all gate', async () => {
    const resolver = new SecureDnaResolver(service as any);
    await expect(resolver.screeningBatch('b1')).resolves.toBeNull();
    await expect(resolver.screeningBatches()).resolves.toEqual([]);
  });
});

describe('SecureDnaResolver batch mutations (F2)', () => {
  const make = (): { createSequencesBatch: jest.Mock; screenSequencesBatch: jest.Mock } => ({
    createSequencesBatch: jest.fn(async () => []),
    screenSequencesBatch: jest.fn(async () => ({ id: 'b1', sequences: [] }))
  });
  const sequences: any = { sequences: [{ name: 'a', sequence: 'ATGC' }] };
  const screening: any = { sequenceIds: ['s1'] };

  it('proceeds for a caller who reached it past the jobs:view-all gate', async () => {
    const service = make();
    const resolver = new SecureDnaResolver(service as any);
    await expect(resolver.createSequencesBatch(sequences, staff)).resolves.toEqual([]);
    await resolver.screenSequencesBatch(screening, staff);
    expect(service.createSequencesBatch).toHaveBeenCalledWith(sequences.sequences, staff.sub);
    expect(service.screenSequencesBatch).toHaveBeenCalledWith(screening, staff.sub);
  });
});
