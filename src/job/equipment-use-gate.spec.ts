import { ForbiddenException } from '@nestjs/common';
import { Role } from '../auth/roles/roles.enum';
import { assertMaySubmitEquipmentUse, equipmentUseServiceNames } from './equipment-use-gate';

const workflows = (...flags: Array<boolean | undefined>): Array<{ nodes: Array<{ service: { name: string; equipmentUse?: boolean } }> }> => [
  { nodes: flags.map((equipmentUse, i) => ({ service: { name: `svc-${i}`, equipmentUse } })) }
];
const actor = (...roles: string[]): { realm_access: { roles: string[] } } => ({ realm_access: { roles } });

describe('equipmentUseServiceNames', () => {
  it('lists each equipment-use service once, by name', () => {
    expect(
      equipmentUseServiceNames([{ nodes: [{ service: { name: 'STAR', equipmentUse: true } }, { service: { name: 'STAR', equipmentUse: true } }, { service: { name: 'PCR', equipmentUse: false } }] }])
    ).toEqual(['STAR']);
  });

  it('is empty for a job with no equipment-use nodes, or no workflows at all', () => {
    expect(equipmentUseServiceNames(workflows(false, undefined))).toEqual([]);
    expect(equipmentUseServiceNames(undefined)).toEqual([]);
  });
});

describe('assertMaySubmitEquipmentUse', () => {
  it('lets a plain client submit a job with no equipment-use node', () => {
    expect(() => assertMaySubmitEquipmentUse(actor(), workflows(false))).not.toThrow();
  });

  it('refuses a plain client who submits an equipment-use node', () => {
    expect(() => assertMaySubmitEquipmentUse(actor(), workflows(false, true))).toThrow(ForbiddenException);
    expect(() => assertMaySubmitEquipmentUse(actor(Role.ExternalCustomer), workflows(true))).toThrow(/svc-0/);
  });

  it('admits equipment users, technicians and administrators', () => {
    for (const role of [Role.ClientUnassistedEquipmentUser, Role.Technician, Role.DamplabStaff]) {
      expect(() => assertMaySubmitEquipmentUse(actor(role), workflows(true))).not.toThrow();
    }
  });
});
