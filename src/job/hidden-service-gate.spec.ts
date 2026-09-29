import { BadRequestException } from '@nestjs/common';
import { Role } from '../auth/roles/roles.enum';
import { assertMaySubmitHiddenServices, hiddenServiceNames, retiredServiceMessage } from './hidden-service-gate';

const workflows = (...services: Array<{ name: string; hiddenFromClients?: boolean }>): any[] => [{ nodes: services.map((service) => ({ service })) }];
const actor = (...roles: string[]): { realm_access: { roles: string[] } } => ({ realm_access: { roles } });

describe('hidden-from-clients gate on createJob (pin 16)', () => {
  it('uses the exact retired sentence', () => {
    expect(retiredServiceMessage('Gibson Assembly')).toBe('“Gibson Assembly” has been retired and can no longer be added to new jobs.');
  });

  it('lists each hidden service once', () => {
    expect(hiddenServiceNames(workflows({ name: 'Old', hiddenFromClients: true }, { name: 'Old', hiddenFromClients: true }, { name: 'PCR' }))).toEqual(['Old']);
  });

  it('refuses a client submitting a hidden operation — a stale local draft included', () => {
    expect(() => assertMaySubmitHiddenServices(actor(), workflows({ name: 'PCR' }, { name: 'Old', hiddenFromClients: true }))).toThrow(BadRequestException);
    expect(() => assertMaySubmitHiddenServices(actor(Role.ClientUnassistedEquipmentUser), workflows({ name: 'Old', hiddenFromClients: true }))).toThrow(
      '“Old” has been retired and can no longer be added to new jobs.'
    );
  });

  it('admits callers holding catalog-editor:read', () => {
    for (const role of [Role.Technician, Role.DamplabStaff]) {
      expect(() => assertMaySubmitHiddenServices(actor(role), workflows({ name: 'Old', hiddenFromClients: true }))).not.toThrow();
    }
  });

  it('lets anyone submit a job with no hidden operation', () => {
    expect(() => assertMaySubmitHiddenServices(actor(), workflows({ name: 'PCR', hiddenFromClients: false }))).not.toThrow();
    expect(() => assertMaySubmitHiddenServices(actor(), undefined as any)).not.toThrow();
  });
});
