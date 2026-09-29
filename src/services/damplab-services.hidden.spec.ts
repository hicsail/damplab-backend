import { DampLabServicesResolver } from './damplab-services.resolver';
import { Role } from '../auth/roles/roles.enum';

const visible = { _id: 'v', name: 'PCR', parameters: [], hiddenFromClients: false };
const hidden = { _id: 'h', name: 'Old', parameters: [], hiddenFromClients: true };
const services = { findAll: jest.fn(async () => [visible, hidden]), findDeletedIds: jest.fn(async () => ['d1']) };
const resolver = new DampLabServicesResolver(services as any);
const user = (...roles: string[]): any => ({ realm_access: { roles } });

describe('hidden operations, server side', () => {
  it('services returns hidden operations to everyone, flagged (pin 14)', async () => {
    const result: any[] = await resolver.services();
    expect(result.map((s) => [s.name, s.hiddenFromClients])).toEqual([
      ['PCR', false],
      ['Old', true]
    ]);
  });

  it('catalogServices omits hidden operations for a client (pin 15)', async () => {
    const rows = await resolver.catalogServices(user());
    expect(rows.map((r) => r.name)).toEqual(['PCR']);
  });

  it('catalogServices keeps them, flagged, for catalog-editor:read', async () => {
    const rows = await resolver.catalogServices(user(Role.Technician));
    expect(rows.map((r) => [r.name, r.hiddenFromClients])).toEqual([
      ['PCR', false],
      ['Old', true]
    ]);
  });

  it('deletedServiceIds lists soft-deleted operation ids', async () => {
    await expect(resolver.deletedServiceIds()).resolves.toEqual(['d1']);
  });
});
