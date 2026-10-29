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
