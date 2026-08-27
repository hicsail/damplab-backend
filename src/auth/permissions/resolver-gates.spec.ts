import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../roles/roles.decorator';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { Permission } from './permission.enum';
import { permissionsForRoles } from './role-permissions';
import { Role } from '../roles/roles.enum';

import { StationResolver } from '../../station/station.resolver';
import { ProtocolMapResolver } from '../../protocol-map/protocol-map.resolver';
import { TemplateResolver } from '../../template/template.resolver';
import { JobResolver } from '../../job/job.resolver';
import { WorkflowResolver } from '../../workflow/workflow.resolver';
import { WorkflowNodeResolver } from '../../workflow/resolvers/node.resolver';
import { InventoryResolver } from '../../inventory/inventory.resolver';
import { BookingResolver } from '../../booking/booking.resolver';
import { DampLabServicesResolver } from '../../services/damplab-services.resolver';
import { BundlesResolver } from '../../bundles/bundles.resolver';
import { CategoryResolver } from '../../categories/categories.resolver';
import { ActivityResolver } from '../../activity/activity.resolver';
import { ApiKeyResolver } from '../../api-key/api-key.resolver';
import { AgentController } from '../../agent/agent.controller';
import { ProtocolsController } from '../../protocols/protocols.controller';
import { TrainingResolver } from '../../training/training.resolver';
import { AnnouncementResolver } from '../../announcements/announcement.resolver';

/**
 * The gate on each operation, asserted directly against the decoration metadata.
 *
 * This is the regression guard for the Phase 2b widening: it is what fails if a
 * later edit drops a `@RequirePermission`, or re-narrows one of these back to
 * `@Roles(Role.DamplabStaff)` and silently 403s a technician on page load. The
 * per-role rows below then check the *consequence* — that the roles the matrix
 * says can reach a page actually satisfy its gate.
 */
const reflector = new Reflector();

/** Method first, then class — the same resolution order `AuthRolesGuard` uses. */
const permissionOn = (target: any, method: string): Permission[] | undefined => reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [target.prototype[method], target]);
const rolesOn = (target: any, method: string): Role[] | undefined => reflector.getAllAndOverride<Role[]>(ROLES_KEY, [target.prototype[method], target]);

type Row = [any, string, Permission];

/**
 * Every operation the widening moved, with the permission it moved to. Grouped by
 * the route that reaches it, matching `docs/phase-2b-narrowing-checklist.md`.
 */
const GATES: Row[] = [
  // /stations — the class-level @Roles used to cover the read too, so the page 403'd on load.
  [StationResolver, 'stations', Permission.LabLayoutRead],
  [StationResolver, 'station', Permission.LabLayoutRead],
  [StationResolver, 'createStation', Permission.LabLayoutWrite],
  [StationResolver, 'updateStation', Permission.LabLayoutWrite],
  [StationResolver, 'deleteStation', Permission.LabLayoutWrite],

  // /protocol-map — same class-level problem.
  [ProtocolMapResolver, 'protocolStepMappings', Permission.ProtocolLibraryRead],
  [ProtocolMapResolver, 'resolveProtocol', Permission.ProtocolLibraryRead],
  [ProtocolMapResolver, 'protocolLibrary', Permission.ProtocolLibraryRead],
  [ProtocolMapResolver, 'upsertProtocolStepMapping', Permission.ProtocolLibraryWrite],
  [ProtocolMapResolver, 'deleteProtocolStepMapping', Permission.ProtocolLibraryWrite],

  // The client-facing catalog page. `catalog:view` is baseline, so this denies
  // nobody — it is here so the gate is explicit and a later edit cannot widen it
  // silently. The wide `services` query stays open by omission: the canvas needs
  // it, and its narrowing happens on the fields (see the pricing strip).
  [DampLabServicesResolver, 'catalogServices', Permission.CatalogView],

  // /data_translation — this resolver had NO guard at all before.
  [TemplateResolver, 'templates', Permission.DataTranslationUse],
  [TemplateResolver, 'template', Permission.DataTranslationUse],
  [TemplateResolver, 'templateByName', Permission.DataTranslationUse],
  [TemplateResolver, 'createTemplate', Permission.DataTranslationUse],
  [TemplateResolver, 'updateTemplate', Permission.DataTranslationUse],
  [TemplateResolver, 'deleteTemplate', Permission.DataTranslationUse],
  [TemplateResolver, 'deleteTemplateByName', Permission.DataTranslationUse],

  // /dashboard and /technician_view/:id
  [JobResolver, 'allJobs', Permission.JobsViewAll],
  [JobResolver, 'jobById', Permission.JobsViewAll],
  [JobResolver, 'jobByName', Permission.JobsViewAll],
  [JobResolver, 'jobByWorkflowId', Permission.JobsViewAll],
  [JobResolver, 'jobsFeedStatus', Permission.JobsViewAll],
  [JobResolver, 'markJobsFeedViewed', Permission.JobsViewAll],
  [JobResolver, 'archiveJob', Permission.JobsViewAll],
  [JobResolver, 'unarchiveJob', Permission.JobsViewAll],
  [WorkflowResolver, 'workflowById', Permission.JobsViewAll],
  [JobResolver, 'jobClients', Permission.JobsViewAll],
  // The merged jobs page. Deliberately the BASELINE permission: this one query
  // serves a client and a technician, and the scope is enforced inside the
  // resolver rather than by the gate. See JobResolver.jobsForViewer.
  [JobResolver, 'jobsForViewer', Permission.JobsView],

  // /lab-monitor/:screen
  [WorkflowNodeResolver, 'getLabMonitorNodes', Permission.LabMonitorView],
  [WorkflowNodeResolver, 'getLabMonitorStaffList', Permission.LabMonitorView],
  [WorkflowNodeResolver, 'changeWorkflowNodeState', Permission.LabMonitorView],
  [WorkflowNodeResolver, 'updateWorkflowNodeAssignee', Permission.LabMonitorView],
  [WorkflowNodeResolver, 'updateWorkflowNodeEstimatedTime', Permission.LabMonitorView],
  [WorkflowNodeResolver, 'setWorkflowNodeUsedInventory', Permission.LabMonitorView],
  [WorkflowResolver, 'getWorkflowByState', Permission.LabMonitorView],
  [WorkflowResolver, 'getWorkflowsByStateForLabMonitor', Permission.LabMonitorView],
  [WorkflowResolver, 'changeWorkflowState', Permission.LabMonitorView],

  // Lab monitor archiving — a state-transition permission, not a page one.
  // Everyone with labmonitor:view may move a card to COMPLETE; only an
  // administrator may take it off the board.
  [WorkflowNodeResolver, 'archiveWorkflowNode', Permission.LabMonitorArchive],
  [WorkflowNodeResolver, 'unarchiveWorkflowNode', Permission.LabMonitorArchive],

  // /technician_bench
  [WorkflowNodeResolver, 'assignedOperations', Permission.BenchUse],
  [WorkflowNodeResolver, 'setWorkflowNodeCompletedSteps', Permission.BenchUse],

  // /inventory and /inventory-calendar
  [WorkflowNodeResolver, 'getInProgressNodesHoldingInventory', Permission.InventoryRead],
  [WorkflowNodeResolver, 'inventoryAvailability', Permission.InventoryRead],
  [InventoryResolver, 'inventoryItems', Permission.InventoryRead],
  [BookingResolver, 'bookings', Permission.InventoryRead],
  [InventoryResolver, 'createInventoryItem', Permission.InventoryWrite],
  [InventoryResolver, 'updateInventoryItem', Permission.InventoryWrite],
  [InventoryResolver, 'deleteInventoryItem', Permission.InventoryWrite],

  // Billing acts that live on pages lower tiers can now reach.
  [BookingResolver, 'confirmBookingUsage', Permission.BillingView],
  [BookingResolver, 'billableBookings', Permission.BillingView],

  // /edit
  [DampLabServicesResolver, 'createService', Permission.CatalogEditorWrite],
  [DampLabServicesResolver, 'updateService', Permission.CatalogEditorWrite],
  [DampLabServicesResolver, 'deleteService', Permission.CatalogEditorWrite],
  [BundlesResolver, 'createBundle', Permission.CatalogEditorWrite],
  [BundlesResolver, 'updateBundle', Permission.CatalogEditorWrite],
  [BundlesResolver, 'deleteBundle', Permission.CatalogEditorWrite],
  [CategoryResolver, 'createCategory', Permission.CatalogEditorWrite],
  [CategoryResolver, 'updateCategory', Permission.CatalogEditorWrite],
  [CategoryResolver, 'deleteCategory', Permission.CatalogEditorWrite],

  // Learning Hub. `training:read` is baseline; whether *drafts* come back is
  // decided from the caller's training:write inside the resolver, not from an
  // argument, so an unpublished guide cannot be read by asking for it.
  [TrainingResolver, 'guides', Permission.TrainingRead],
  [TrainingResolver, 'guideBySlug', Permission.TrainingRead],
  [TrainingResolver, 'createGuide', Permission.TrainingWrite],
  [TrainingResolver, 'updateGuide', Permission.TrainingWrite],
  [TrainingResolver, 'deleteGuide', Permission.TrainingWrite],

  // Announcements. `announcements:read` is baseline and stays open to everyone —
  // what narrows is the rows, by audience, inside the resolver.
  [AnnouncementResolver, 'announcements', Permission.AnnouncementsRead],
  [AnnouncementResolver, 'allAnnouncements', Permission.AnnouncementsWrite],
  [AnnouncementResolver, 'createAnnouncement', Permission.AnnouncementsWrite],
  [AnnouncementResolver, 'updateAnnouncement', Permission.AnnouncementsWrite],
  [AnnouncementResolver, 'deleteAnnouncement', Permission.AnnouncementsWrite],

  // Administrator-only surfaces, re-pointed off the role so there is one vocabulary.
  [ActivityResolver, 'activityEvents', Permission.LabStatusTvView],
  [ApiKeyResolver, 'createApiKey', Permission.ApiKeysManage],
  [AgentController, 'labStatusChat', Permission.LabAssistantUse]
];

describe('Phase 2b widening — the gate on each operation', () => {
  it.each(GATES)('%p.%s requires %s', (target, method, permission) => {
    expect({ method, permissions: permissionOn(target, method) }).toEqual({ method, permissions: [permission] });
  });

  /**
   * The one gate that cannot be a decoration. `/api/protocols/:id` is reached from
   * BOTH the technician bench (`bench:use`) and the Protocol Library
   * (`protocol-library:read`), and `@RequirePermission` requires *all* the
   * permissions it lists — so an either/or has to be an inline check. Asserted here
   * so a later "tidy this up into a decorator" is caught: it would 403 equipment
   * users on the bench, who hold bench:use and not protocol-library:read.
   */
  it('leaves the protocols proxy on an inline either/or check, not a decoration', () => {
    expect(permissionOn(ProtocolsController, 'getProtocol')).toBeUndefined();
    expect(rolesOn(ProtocolsController, 'getProtocol')).toBeUndefined();
    const equipmentUser = permissionsForRoles([Role.ClientUnassistedEquipmentUser]);
    expect(equipmentUser.has(Permission.BenchUse)).toBe(true);
    expect(equipmentUser.has(Permission.ProtocolLibraryRead)).toBe(false);
  });

  it('leaves no @Roles behind on any of them', () => {
    // A leftover @Roles(DamplabStaff) is evaluated IN ADDITION to the permission,
    // so it would silently re-deny every technician the widening was for.
    const leftovers = GATES.filter(([target, method]) => (rolesOn(target, method) ?? []).length > 0).map(([target, method]) => `${target.name}.${method}`);
    expect(leftovers).toEqual([]);
  });
});

describe('Phase 2b widening — who each gate lets through', () => {
  const roleSets: Array<[string, Set<Permission>]> = [
    ['administrator', permissionsForRoles([Role.DamplabStaff])],
    ['technician', permissionsForRoles([Role.Technician])],
    ['equipment user', permissionsForRoles([Role.ClientUnassistedEquipmentUser])],
    ['client', permissionsForRoles([])]
  ];

  const reach = (permission: Permission): string[] => roleSets.filter(([, granted]) => granted.has(permission)).map(([name]) => name);

  /**
   * The point of the whole phase: these are the pages Phase 2a moved down a tier
   * without moving the resolvers behind them, so their occupants got a homepage
   * full of buttons that 403'd on load.
   */
  it('lets a technician load every page the routes now give them', () => {
    for (const permission of [
      Permission.LabLayoutRead,
      Permission.ProtocolLibraryRead,
      Permission.JobsViewAll,
      Permission.LabMonitorView,
      Permission.InventoryRead,
      Permission.InventorySchedule,
      Permission.BenchUse,
      Permission.CatalogEditorRead,
      Permission.LabAssistantUse
    ]) {
      expect({ permission, reachable: reach(permission).includes('technician') }).toEqual({ permission, reachable: true });
    }
  });

  it('lets an equipment user reach My Bench and the Inventory Schedule', () => {
    expect(reach(Permission.BenchUse)).toContain('equipment user');
    expect(reach(Permission.InventorySchedule)).toContain('equipment user');
    expect(reach(Permission.InventoryRead)).toContain('equipment user');
  });

  it('does not let a technician or equipment user write the catalog, layout or inventory', () => {
    for (const permission of [Permission.CatalogEditorWrite, Permission.LabLayoutWrite, Permission.InventoryWrite]) {
      expect({ permission, reach: reach(permission) }).toEqual({ permission, reach: ['administrator'] });
    }
  });

  it('keeps confirm-usage administrator-only even though the page it sits on widened', () => {
    expect(reach(Permission.BillingView)).toEqual(['administrator']);
  });

  it('keeps the client baseline out of every widened page', () => {
    // `catalog:view` is the one baseline permission in the table — it gates the
    // client-facing catalog, which clients are supposed to reach. Everything else
    // here is above the floor.
    for (const [, , permission] of GATES) {
      // The four baseline permissions in the table. Each gates a page everyone
      // reaches, and each narrows *what comes back* inside its resolver rather than
      // at the gate: the catalog's pricing tiers, the jobs scope, announcement
      // audiences, and unpublished guides. Everything else here is above the floor.
      if ([Permission.CatalogView, Permission.JobsView, Permission.TrainingRead, Permission.AnnouncementsRead].includes(permission)) continue;
      expect({ permission, client: reach(permission).includes('client') }).toEqual({ permission, client: false });
    }
    expect(reach(Permission.CatalogView)).toContain('client');
    expect(reach(Permission.JobsView)).toContain('client');
    expect(reach(Permission.TrainingRead)).toContain('client');
    expect(reach(Permission.AnnouncementsRead)).toContain('client');
  });
});
