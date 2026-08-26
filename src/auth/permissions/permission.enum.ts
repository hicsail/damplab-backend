/**
 * The permission vocabulary. `resource:action` strings, deliberately plain strings
 * rather than anything role-shaped — a permission says what may be done, never who
 * may do it. Who is answered once, in `role-permissions.ts`.
 *
 * This enum and `docs/access-matrix.md` must agree; `role-permissions.spec.ts` is
 * where that agreement is asserted.
 */
export enum Permission {
  /** See jobs you own. Part of the client baseline — every authenticated user has it. */
  JobsView = 'jobs:view',
  /** The staff jobs dashboard: see everyone's jobs. */
  JobsViewAll = 'jobs:view-all',
  /** Submit a job on a client's behalf (Q7: Administrator and Equipment User only). */
  JobSubmitForClient = 'job:submit-for-client',

  ReleaseNotesView = 'releasenotes:view',
  AnnouncementsRead = 'announcements:read',
  AnnouncementsWrite = 'announcements:write',
  TrainingRead = 'training:read',
  TrainingWrite = 'training:write',
  BugsReport = 'bugs:report',
  BugBacklogView = 'bugbacklog:view',

  /** The services catalog page. */
  CatalogView = 'catalog:view',
  CatalogEditorRead = 'catalog-editor:read',
  CatalogEditorWrite = 'catalog-editor:write',
  ProtocolLibraryRead = 'protocol-library:read',
  ProtocolLibraryWrite = 'protocol-library:write',
  LabLayoutRead = 'lab-layout:read',
  LabLayoutWrite = 'lab-layout:write',

  InventoryRead = 'inventory:read',
  InventoryWrite = 'inventory:write',
  /** Book a machine or consumable for yourself. */
  InventoryBook = 'inventory:book',
  /** The lab-wide inventory schedule. */
  InventorySchedule = 'inventory:schedule',

  LabMonitorView = 'labmonitor:view',
  /** Archive a lab-monitor card. Everyone else can only move it to completed. */
  LabMonitorArchive = 'labmonitor:archive',
  LabStatusTvView = 'labstatustv:view',
  /** The technician bench. */
  BenchUse = 'bench:use',

  BillingView = 'billing:view',
  CustomersManage = 'customers:manage',
  ApiKeysManage = 'apikeys:manage',
  DataTranslationUse = 'datatranslation:use',
  LabAssistantUse = 'labassistant:use',

  /**
   * Read model fields marked internal — `DampLabService.notes` and inventory's
   * `serialNumber` / `hasServiceContract` / `serviceContractExpiration`. Without it
   * those fields resolve to null rather than being omitted, because the query shape
   * is shared with client-facing pages.
   */
  InternalFieldsRead = 'internal-fields:read'
}

export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(Object.values(Permission));
