import { WorkflowNodeState } from '../models/node.model';

export interface ReadinessNode {
  id: string;
  state: WorkflowNodeState;
}

export interface ReadinessEdge {
  source: string;
  target: string;
}

/**
 * The operations in a workflow that nothing is holding up: every predecessor,
 * direct or transitive, is COMPLETE.
 *
 * Computed here rather than in the browser because a blocking predecessor is
 * often assigned to somebody else, so the bench's own list of nodes cannot
 * answer it. Working in `WorkflowNodeState` values keeps the comparison on the
 * stored representation, away from the enum's numeric-vs-name serialisation.
 *
 * Completed nodes stay in the result. "Ready" here means "not blocked"; whether
 * to show finished work is the caller's decision.
 *
 * Two malformed-graph cases resolve towards showing too much rather than too
 * little — an over-full bench is a nuisance, an empty one with no explanation is
 * a support ticket:
 *
 *  - An edge naming a node the workflow does not contain is ignored, rather than
 *    blocking its target forever.
 *  - A cycle makes every node in the workflow ready. Nothing should ever produce
 *    one; if something does, the technician still sees their work.
 */
export function readyOperationIds(workflow: { nodes: ReadinessNode[]; edges: ReadinessEdge[] }): Set<string> {
  const state = new Map(workflow.nodes.map((n) => [n.id, n.state]));
  const all = new Set(state.keys());

  const predecessors = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    if (!all.has(edge.source) || !all.has(edge.target)) continue;
    predecessors.set(edge.target, [...(predecessors.get(edge.target) ?? []), edge.source]);
  }

  if (hasCycle(all, predecessors)) return all;

  const blocked = new Map<string, boolean>();

  /** True when anything upstream of this node is not yet COMPLETE. Acyclic by the check above. */
  const isBlocked = (id: string): boolean => {
    const cached = blocked.get(id);
    if (cached !== undefined) return cached;
    // Seeded before recursing so the memo is never consulted mid-computation.
    blocked.set(id, false);
    const result = (predecessors.get(id) ?? []).some((p) => state.get(p) !== WorkflowNodeState.COMPLETE || isBlocked(p));
    blocked.set(id, result);
    return result;
  };

  return new Set([...all].filter((id) => !isBlocked(id)));
}

/**
 * Cycle detection over the predecessor graph, run before readiness rather than
 * during it. Interleaving the two silently misses cycles: the "is my predecessor
 * complete" test short-circuits before it ever recurses far enough to revisit a
 * node.
 */
function hasCycle(all: Set<string>, predecessors: Map<string, string[]>): boolean {
  const DONE = 2;
  const IN_PROGRESS = 1;
  const mark = new Map<string, number>();

  const visit = (id: string): boolean => {
    const seen = mark.get(id);
    if (seen === DONE) return false;
    if (seen === IN_PROGRESS) return true;
    mark.set(id, IN_PROGRESS);
    if ((predecessors.get(id) ?? []).some(visit)) return true;
    mark.set(id, DONE);
    return false;
  };

  return [...all].some(visit);
}
