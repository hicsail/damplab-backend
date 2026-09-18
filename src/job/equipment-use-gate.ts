import { ForbiddenException } from '@nestjs/common';
import { Permission } from '../auth/permissions/permission.enum';
import { hasPermission, PermissionActor } from '../auth/permissions/permissions';

/**
 * The server-side twin of the canvas palette hiding equipment-use operations from
 * plain clients. The palette is a convenience; this is the gate. A submission
 * that carries even one equipment-use node needs `job:equipment-use` on the
 * *submitter* — for a staff member submitting on a client's behalf that is the
 * staff member, which is the point: the lab decides who books instruments.
 *
 * Pure over the already-piped workflows so it can be unit tested without Nest.
 */
type NodeLike = { service?: unknown };
type WorkflowLike = { nodes?: ReadonlyArray<NodeLike> };

/** The node's service, when the pipe has populated it; an unpopulated ObjectId has no flag to read. */
function populatedService(service: unknown): { name?: string; equipmentUse?: boolean } | undefined {
  return service && typeof service === 'object' && 'equipmentUse' in service ? (service as { name?: string; equipmentUse?: boolean }) : undefined;
}

export function equipmentUseServiceNames(workflows: ReadonlyArray<WorkflowLike> | undefined): string[] {
  const names = new Set<string>();
  for (const workflow of workflows ?? []) {
    for (const node of workflow.nodes ?? []) {
      const service = populatedService(node.service);
      if (service?.equipmentUse === true) names.add(service.name ?? 'Equipment use');
    }
  }
  return [...names];
}

export function assertMaySubmitEquipmentUse(actor: PermissionActor | undefined | null, workflows: ReadonlyArray<WorkflowLike> | undefined): void {
  const names = equipmentUseServiceNames(workflows);
  if (names.length === 0) return;
  if (hasPermission(actor, Permission.JobEquipmentUse)) return;
  throw new ForbiddenException(`Equipment-use operations are only available to unassisted equipment users: ${names.join(', ')}. Remove them from the job or ask the lab for equipment-user access.`);
}
