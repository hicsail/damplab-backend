import { BadRequestException } from '@nestjs/common';
import { Permission } from '../auth/permissions/permission.enum';
import { hasPermission, PermissionActor } from '../auth/permissions/permissions';

/**
 * The server-side twin of the palette hiding retired operations. Lives beside
 * `assertMaySubmitEquipmentUse` and runs where it does — in `createJob`, over the
 * already-piped workflows — because `AddNodeInputPipe` cannot see the caller
 * (its REQUEST is the GraphQL context, not the HTTP request).
 *
 * Only *new* jobs: editing or re-versioning an existing job (job-version path,
 * `/resubmission/:id`) and staff's `addWorkflowToJob` never pass through here.
 */
type NodeLike = { service?: unknown };
type WorkflowLike = { nodes?: ReadonlyArray<NodeLike> };

export function retiredServiceMessage(name: string): string {
  return `“${name}” has been retired and can no longer be added to new jobs.`;
}

export function hiddenServiceNames(workflows: ReadonlyArray<WorkflowLike> | undefined): string[] {
  const names = new Set<string>();
  for (const workflow of workflows ?? []) {
    for (const node of workflow.nodes ?? []) {
      const service = node.service as { name?: string; hiddenFromClients?: boolean } | undefined;
      if (service && typeof service === 'object' && service.hiddenFromClients === true) names.add(service.name ?? 'This operation');
    }
  }
  return [...names];
}

export function assertMaySubmitHiddenServices(actor: PermissionActor | undefined | null, workflows: ReadonlyArray<WorkflowLike> | undefined): void {
  const names = hiddenServiceNames(workflows);
  if (names.length === 0) return;
  if (hasPermission(actor, Permission.CatalogEditorRead)) return;
  throw new BadRequestException(retiredServiceMessage(names[0]));
}
