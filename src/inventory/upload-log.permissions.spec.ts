import { ForbiddenException } from '@nestjs/common';
import { Permission } from '../auth/permissions/permission.enum';
import { Role } from '../auth/roles/roles.enum';
import { UploadEntityType } from './upload-log.model';
import { uploadLogWritePermission } from './upload-log.permissions';
import { UploadLogResolver } from './upload-log.resolver';

describe('upload log write permission', () => {
  it('maps each entity type to the permission that writes that data', () => {
    expect(uploadLogWritePermission(UploadEntityType.INVENTORY)).toBe(Permission.InventoryWrite);
    for (const type of [UploadEntityType.OPERATION, UploadEntityType.PARAMETER_SET, UploadEntityType.BUNDLE, UploadEntityType.SOW_SECTION]) {
      expect(uploadLogWritePermission(type)).toBe(Permission.CatalogEditorWrite);
    }
  });

  it('has exactly the five entity types', () => {
    expect(Object.values(UploadEntityType)).toEqual(['INVENTORY', 'OPERATION', 'PARAMETER_SET', 'BUNDLE', 'SOW_SECTION']);
  });

  it.each(['PARAMETER_SET', 'BUNDLE', 'SOW_SECTION'])('createUploadLog refuses a technician and records for an administrator: %s', async (entityType) => {
    const service = { create: jest.fn(async (input: any) => input) };
    const resolver = new UploadLogResolver(service as any);
    const input: any = { entityType, uploaderName: 'x', fileName: 'f.xlsx', rowCount: 1, createdCount: 1, updatedCount: 0, skippedCount: 0, failedCount: 0 };
    await expect(resolver.createUploadLog(input, { realm_access: { roles: [Role.Technician] } } as any)).rejects.toThrow(ForbiddenException);
    await expect(resolver.createUploadLog(input, { realm_access: { roles: [Role.DamplabStaff] } } as any)).resolves.toMatchObject({ entityType });
  });

  it('createUploadLog refuses a technician and records for an administrator', async () => {
    const service = { create: jest.fn(async (input: any) => input) };
    const resolver = new UploadLogResolver(service as any);
    const input: any = { entityType: UploadEntityType.OPERATION, uploaderName: 'x', fileName: 'f.xlsx', rowCount: 1, createdCount: 1, updatedCount: 0, skippedCount: 0, failedCount: 0 };
    await expect(resolver.createUploadLog(input, { realm_access: { roles: [Role.Technician] } } as any)).rejects.toThrow(ForbiddenException);
    await expect(resolver.createUploadLog(input, { realm_access: { roles: [Role.DamplabStaff] } } as any)).resolves.toMatchObject({ entityType: 'OPERATION' });
  });
});
