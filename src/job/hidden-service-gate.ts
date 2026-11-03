/**
 * Retired operations are hidden from the service palette. They are not a
 * submit check: a job that already contains one — a chatbot draft, a loaded
 * file, an old workflow — still submits.
 */

type NodeLike = { service?: unknown };
type WorkflowLike = { nodes?: ReadonlyArray<NodeLike> };

/** Names of retired operations already on a workflow, each once. Informational. */
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
