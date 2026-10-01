import { Permission } from '../auth/permissions/permission.enum';
import { UploadEntityType } from './upload-log.model';

/** Recording an upload needs the permission that could have made its changes. */
export function uploadLogWritePermission(entityType: UploadEntityType): Permission {
  return entityType === UploadEntityType.OPERATION ? Permission.CatalogEditorWrite : Permission.InventoryWrite;
}
