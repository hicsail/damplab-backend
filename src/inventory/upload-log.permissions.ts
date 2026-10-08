import { Permission } from '../auth/permissions/permission.enum';
import { UploadEntityType } from './upload-log.model';

/**
 * Recording an upload needs the permission that could have made its changes:
 * inventory:write for the inventory workbook, catalog-editor:write for every
 * sheet of the catalog workbook (OPERATION, PARAMETER_SET, BUNDLE, SOW_SECTION).
 * Written as "inventory, else catalog" so a type added later is never
 * recordable with the narrower inventory permission by default.
 */
export function uploadLogWritePermission(entityType: UploadEntityType): Permission {
  return entityType === UploadEntityType.INVENTORY ? Permission.InventoryWrite : Permission.CatalogEditorWrite;
}
