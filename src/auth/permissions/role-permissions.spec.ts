import { Role } from '../roles/roles.enum';
import { ALL_PERMISSIONS, Permission } from './permission.enum';
import { API_KEY_PERMISSIONS, BASELINE_PERMISSIONS, customerPermissionsForRoles, permissionsForRoles, ROLE_PERMISSIONS, STAFF_FLAVORED_ROLES } from './role-permissions';

const sorted = (permissions: Iterable<Permission>): Permission[] => [...permissions].sort();

/**
 * This spec IS the access matrix, encoded. `docs/access-matrix.md` is its source.
 *
 * Caveat carried from that file: the matrix was transcribed from the overhaul plan,
 * not diffed against the source spreadsheet, so this spec currently pins a
 * transcription. Diff the doc, then trust this.
 */
describe('ROLE_PERMISSIONS — the matrix', () => {
  it('gives Administrator every permission, so day-one staff access is unchanged', () => {
    expect(sorted(ROLE_PERMISSIONS[Role.DamplabStaff])).toEqual(sorted(ALL_PERMISSIONS));
  });

  it('gives Technician exactly the matrix set', () => {
    expect(sorted(permissionsForRoles([Role.Technician]))).toEqual(
      sorted([
        // baseline
        Permission.JobsView,
        Permission.CatalogView,
        Permission.AnnouncementsRead,
        Permission.TrainingRead,
        Permission.BugsReport,
        // technician
        Permission.ReleaseNotesView,
        Permission.JobsViewAll,
        Permission.BugBacklogView,
        Permission.CatalogEditorRead,
        Permission.ProtocolLibraryRead,
        Permission.ProtocolLibraryWrite,
        Permission.LabLayoutRead,
        Permission.InventoryRead,
        Permission.InventoryBook,
        Permission.InventorySchedule,
        Permission.LabMonitorView,
        Permission.BenchUse,
        Permission.LabAssistantUse,
        Permission.InternalFieldsRead,
        Permission.JobEquipmentUse
      ])
    );
  });

  it('gives the equipment user exactly the matrix set', () => {
    expect(sorted(permissionsForRoles([Role.ClientUnassistedEquipmentUser]))).toEqual(
      sorted([
        Permission.JobsView,
        Permission.CatalogView,
        Permission.AnnouncementsRead,
        Permission.TrainingRead,
        Permission.BugsReport,
        Permission.JobEquipmentUse,
        Permission.InventoryRead,
        Permission.InventoryBook,
        Permission.InventorySchedule
      ])
    );
  });

  it('keeps equipment-use operations off the client floor', () => {
    expect(permissionsForRoles([]).has(Permission.JobEquipmentUse)).toBe(false);
    expect(permissionsForRoles([Role.ClientUnassistedEquipmentUser]).has(Permission.JobEquipmentUse)).toBe(true);
    expect(permissionsForRoles([Role.Technician]).has(Permission.JobEquipmentUse)).toBe(true);
  });

  it('keeps Staff submit job to administrators: Q7 gave it to equipment users, withdrawn 2026-09-18', () => {
    expect(permissionsForRoles([Role.ClientUnassistedEquipmentUser]).has(Permission.JobSubmitForClient)).toBe(false);
    expect(permissionsForRoles([Role.Technician]).has(Permission.JobSubmitForClient)).toBe(false);
    expect(permissionsForRoles([Role.DamplabStaff]).has(Permission.JobSubmitForClient)).toBe(true);
  });

  it('keeps the equipment user off the staff pages: My Bench, the Lab Monitors and Release Notes', () => {
    const equipmentUser = permissionsForRoles([Role.ClientUnassistedEquipmentUser]);
    for (const permission of [Permission.BenchUse, Permission.LabMonitorView, Permission.ReleaseNotesView]) {
      expect({ permission, has: equipmentUser.has(permission) }).toEqual({ permission, has: false });
    }
    expect(permissionsForRoles([]).has(Permission.ReleaseNotesView)).toBe(false);
    expect(permissionsForRoles([Role.Technician]).has(Permission.ReleaseNotesView)).toBe(true);
  });

  it('keeps write above read: only Administrator writes the catalog, layout, inventory, announcements and training', () => {
    const technician = permissionsForRoles([Role.Technician]);
    for (const write of [Permission.CatalogEditorWrite, Permission.LabLayoutWrite, Permission.InventoryWrite, Permission.AnnouncementsWrite, Permission.TrainingWrite, Permission.LabMonitorArchive]) {
      expect(technician.has(write)).toBe(false);
      expect(permissionsForRoles([Role.DamplabStaff]).has(write)).toBe(true);
    }
    // Protocol Library is the exception: the matrix gives technicians write too.
    expect(technician.has(Permission.ProtocolLibraryWrite)).toBe(true);
  });

  it('encodes the three amendments to the transcription', () => {
    // docs/access-matrix.md, "Amendments to the transcription". These are NOT in
    // the source spreadsheet yet; this test is what keeps doc and code together.
    const technician = permissionsForRoles([Role.Technician]);
    const equipmentUser = permissionsForRoles([Role.ClientUnassistedEquipmentUser]);
    expect(technician.has(Permission.LabAssistantUse)).toBe(true);
    expect(equipmentUser.has(Permission.InventorySchedule)).toBe(true);
    // The My Bench amendment was itself reversed on 2026-09-18.
    expect(equipmentUser.has(Permission.BenchUse)).toBe(false);
    // Widening the pages did not widen the billing act inside one of them.
    expect(equipmentUser.has(Permission.BillingView)).toBe(false);
  });

  it('has an entry for every role string the app knows about', () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });
});

describe('the baseline floor — no user can be locked out', () => {
  it('resolves an EMPTY role list to the client baseline, including jobs:view', () => {
    const granted = permissionsForRoles([]);
    expect(sorted(granted)).toEqual(sorted(BASELINE_PERMISSIONS));
    // The regression the floor exists to prevent: a client losing My Jobs.
    expect(granted.has(Permission.JobsView)).toBe(true);
  });

  it('resolves undefined and unknown role strings to the baseline rather than throwing', () => {
    expect(sorted(permissionsForRoles(undefined))).toEqual(sorted(BASELINE_PERMISSIONS));
    expect(sorted(permissionsForRoles(['offline_access', 'default-roles-damplab', 'not-a-real-role']))).toEqual(sorted(BASELINE_PERMISSIONS));
  });

  it('makes CLIENT a strict subset of every other role, which is what makes the floor safe', () => {
    for (const role of [Role.DamplabStaff, Role.Technician, Role.ClientUnassistedEquipmentUser]) {
      const granted = permissionsForRoles([role]);
      for (const permission of BASELINE_PERMISSIONS) {
        expect({ role, permission, has: granted.has(permission) }).toEqual({ role, permission, has: true });
      }
    }
  });

  it('does not put default-roles-damplab in the table — the floor is code, not realm plumbing', () => {
    expect(ROLE_PERMISSIONS['default-roles-damplab']).toBeUndefined();
  });
});

describe('permissionsForRoles unions across roles', () => {
  it('unions an external customer holding the equipment-user role', () => {
    const granted = permissionsForRoles([Role.ExternalCustomer, Role.ClientUnassistedEquipmentUser]);
    expect(granted.has(Permission.JobEquipmentUse)).toBe(true);
    expect(granted.has(Permission.InventoryBook)).toBe(true);
    expect(granted.has(Permission.JobsView)).toBe(true);
    expect(granted.has(Permission.CustomersManage)).toBe(false);
  });

  it('leaves a technician who still holds damplab-staff completely unrestricted', () => {
    // The caveat that governs the rollout: the restriction bites only when
    // damplab-staff is removed.
    expect(sorted(permissionsForRoles([Role.DamplabStaff, Role.Technician]))).toEqual(sorted(ALL_PERMISSIONS));
  });
});

describe('asCustomer subtracts exactly the staff-flavoured roles', () => {
  it('subtracts damplab-staff and technician', () => {
    expect(STAFF_FLAVORED_ROLES).toEqual([Role.DamplabStaff, Role.Technician]);
    expect(sorted(customerPermissionsForRoles([Role.DamplabStaff]))).toEqual(sorted(BASELINE_PERMISSIONS));
    expect(sorted(customerPermissionsForRoles([Role.Technician]))).toEqual(sorted(BASELINE_PERMISSIONS));
  });

  it('does NOT subtract client-unassisted-equipment-user — it is a client variant', () => {
    const asCustomer = customerPermissionsForRoles([Role.DamplabStaff, Role.ClientUnassistedEquipmentUser]);
    expect(asCustomer.has(Permission.JobEquipmentUse)).toBe(true);
    expect(asCustomer.has(Permission.InventoryBook)).toBe(true);
    expect(asCustomer.has(Permission.CustomersManage)).toBe(false);
  });

  it('equals effective for a non-staff caller', () => {
    const roles = [Role.ExternalCustomer, Role.ClientUnassistedEquipmentUser];
    expect(sorted(customerPermissionsForRoles(roles))).toEqual(sorted(permissionsForRoles(roles)));
  });
});

describe('API_KEY_PERMISSIONS', () => {
  it('excludes internal-fields:read, so a key cannot pull staff-only fields', () => {
    expect(API_KEY_PERMISSIONS).not.toContain(Permission.InternalFieldsRead);
  });

  it('contains no write or management permission', () => {
    const forbidden = [
      Permission.CatalogEditorWrite,
      Permission.LabLayoutWrite,
      Permission.InventoryWrite,
      Permission.AnnouncementsWrite,
      Permission.TrainingWrite,
      Permission.ProtocolLibraryWrite,
      Permission.LabMonitorArchive,
      Permission.CustomersManage,
      Permission.ApiKeysManage,
      Permission.DataTranslationUse,
      Permission.JobSubmitForClient
    ];
    for (const permission of forbidden) {
      expect(API_KEY_PERMISSIONS).not.toContain(permission);
    }
  });
});
