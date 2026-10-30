import { ForbiddenException } from '@nestjs/common';
import { SecureDnaResolver } from './securedna.resolver';

const staff: any = { sub: 'staff-1', email: 's@bu.edu', preferred_username: 's', realm_access: { roles: ['damplab-staff'] } };

describe('SecureDnaResolver batch reads (F2)', () => {
  const service = { listScreeningBatches: jest.fn(async () => []), findBatchById: jest.fn(async () => null) };

  it('refuses staff whose showBiosecurity is false', async () => {
    const resolver = new SecureDnaResolver(service as any, { userShowsBiosecurity: jest.fn(async () => false) } as any);
    await expect(resolver.screeningBatches(staff)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(resolver.screeningBatch('b1', staff)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.findBatchById).not.toHaveBeenCalled();
  });

  it('serves staff who see biosecurity', async () => {
    const resolver = new SecureDnaResolver(service as any, { userShowsBiosecurity: jest.fn(async () => true) } as any);
    await expect(resolver.screeningBatch('b1', staff)).resolves.toBeNull();
    await expect(resolver.screeningBatches(staff)).resolves.toEqual([]);
  });
});

describe('SecureDnaResolver batch mutations (F2)', () => {
  const make = (): { createSequencesBatch: jest.Mock; screenSequencesBatch: jest.Mock } => ({
    createSequencesBatch: jest.fn(async () => []),
    screenSequencesBatch: jest.fn(async () => ({ id: 'b1', sequences: [] }))
  });
  const sequences: any = { sequences: [{ name: 'a', sequence: 'ATGC' }] };
  const screening: any = { sequenceIds: ['s1'] };

  it('refuses staff whose showBiosecurity is false before touching the service', async () => {
    const service = make();
    const resolver = new SecureDnaResolver(service as any, { userShowsBiosecurity: jest.fn(async () => false) } as any);
    await expect(resolver.createSequencesBatch(sequences, staff)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(resolver.screenSequencesBatch(screening, staff)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.createSequencesBatch).not.toHaveBeenCalled();
    expect(service.screenSequencesBatch).not.toHaveBeenCalled();
  });

  it('proceeds for staff who see biosecurity', async () => {
    const service = make();
    const resolver = new SecureDnaResolver(service as any, { userShowsBiosecurity: jest.fn(async () => true) } as any);
    await expect(resolver.createSequencesBatch(sequences, staff)).resolves.toEqual([]);
    await resolver.screenSequencesBatch(screening, staff);
    expect(service.createSequencesBatch).toHaveBeenCalledWith(sequences.sequences, staff.sub);
    expect(service.screenSequencesBatch).toHaveBeenCalledWith(screening, staff.sub);
  });
});
