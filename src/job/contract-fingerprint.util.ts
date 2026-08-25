import { createHash } from 'crypto';
import { RUN_COUNT_PARAM_ID } from '../pricing/service-pricing.util';

/** True for a value that carries no information: never counted as contract-relevant. */
export function isEmptyParamValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.every((v) => v === null || v === undefined || v === '');
  return false;
}

export function paramValuesById(formData: unknown): Map<string, unknown> {
  const byId = new Map<string, unknown>();
  const entries = Array.isArray(formData) ? formData : [];
  for (const entry of entries) {
    if (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') {
      byId.set((entry as { id: string }).id, (entry as { value?: unknown }).value ?? null);
    }
  }
  // An absent run count means one run — that is how pricing reads it — so a
  // stored node from before the universal run-count entry existed must compare
  // equal to an editor payload that spells the default out.
  if (!byId.has(RUN_COUNT_PARAM_ID)) byId.set(RUN_COUNT_PARAM_ID, 1);
  return byId;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[key] = (val as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return val;
  });
}

/** Canonical string form shared by save comparison and contract projection. */
export function canonicalizeParamValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);
  return stableStringify(value);
}

/** Whether two parameter values carry the same semantic information. */
export function paramValuesSemanticallyEqual(a: unknown, b: unknown): boolean {
  if (isEmptyParamValue(a) && isEmptyParamValue(b)) return true;
  if (isEmptyParamValue(a) || isEmptyParamValue(b)) return false;
  return canonicalizeParamValue(a) === canonicalizeParamValue(b);
}

/** Non-empty parameter values in stable id order, sharing save-comparison semantics. */
function normalizedNonEmptyParameters(formData: unknown): Record<string, string> {
  const byId = paramValuesById(formData);
  const result: Record<string, string> = {};
  for (const id of [...byId.keys()].sort()) {
    const value = byId.get(id);
    if (isEmptyParamValue(value)) continue;
    // Default run count is equivalent to absent and is omitted from the contract.
    if (id === RUN_COUNT_PARAM_ID && String(value) === '1') continue;
    result[id] = canonicalizeParamValue(value);
  }
  return result;
}

function priceToCents(price: number | undefined | null): number | null {
  if (price == null || !Number.isFinite(price)) return null;
  return Math.round(price * 100);
}

function compareLexical(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareEdgeEndpoints(a: [string, string], b: [string, string]): number {
  return compareLexical(a[0], b[0]) || compareLexical(a[1], b[1]);
}

/**
 * Total order over canonical nodes.
 *
 * Node id first, then the node's own canonical form as a tie-break. Ids are
 * client-side canvas ids and are not guaranteed unique across the workflows of
 * one job, so sorting on the id alone would leave a collision's order decided by
 * the input — which is exactly what this ordering exists to neutralize.
 */
function compareCanonicalNodes(a: CanonicalContractNode, b: CanonicalContractNode): number {
  return compareLexical(a.id, b.id) || compareLexical(stableStringify(a), stableStringify(b));
}

export interface ContractFingerprintNodeInput {
  id: string;
  label?: string;
  serviceId?: string;
  serviceName?: string;
  formData?: unknown;
  additionalInstructions?: string;
  price?: number;
  position?: { x: number; y: number };
  [key: string]: unknown;
}

export interface ContractFingerprintEdgeInput {
  id?: string;
  source: string;
  target: string;
}

export interface ContractFingerprintWorkflowInput {
  workflowId?: string;
  name?: string;
  nodes: ContractFingerprintNodeInput[];
  edges?: ContractFingerprintEdgeInput[];
}

export interface ContractFingerprintInput {
  customerCategory?: string | null;
  workflows: ContractFingerprintWorkflowInput[];
}

export interface CanonicalContractNode {
  id: string;
  serviceId?: string;
  parameters: Record<string, string>;
  additionalInstructions: string;
  priceCents: number | null;
}

export interface CanonicalContract {
  customerCategory: string;
  nodes: CanonicalContractNode[];
  edges: [string, string][];
}

/**
 * Deterministic contract projection used for acceptance comparison.
 *
 * Nodes, edges and the workflows they come from are all sorted, because none of
 * those orderings carries contract meaning and every one of them is client
 * controlled: `saveJobWorkflows` writes `workflow.nodes` straight from the
 * editor payload, so dragging a node can reorder the stored array. Left
 * unsorted, that would flip the fingerprint with nothing about the agreement
 * having changed, and the SOW gate would report JOB_CHANGED_SINCE_ACCEPTANCE
 * with no change for staff to point at.
 */
export function projectContract(input: ContractFingerprintInput): CanonicalContract {
  const nodes: CanonicalContractNode[] = [];
  const edgePairs: [string, string][] = [];

  for (const workflow of input.workflows ?? []) {
    for (const node of workflow.nodes ?? []) {
      nodes.push({
        id: node.id,
        serviceId: node.serviceId,
        parameters: normalizedNonEmptyParameters(node.formData),
        additionalInstructions: (node.additionalInstructions ?? '').trim(),
        priceCents: priceToCents(node.price)
      });
    }
    for (const edge of workflow.edges ?? []) {
      if (edge.source && edge.target) {
        edgePairs.push([edge.source, edge.target]);
      }
    }
  }

  nodes.sort(compareCanonicalNodes);
  edgePairs.sort(compareEdgeEndpoints);

  return {
    customerCategory: input.customerCategory ?? '',
    nodes,
    edges: edgePairs
  };
}

/** SHA-256 hash of the canonical contract projection. */
export function contractFingerprint(input: ContractFingerprintInput): string {
  const projection = projectContract(input);
  return createHash('sha256').update(stableStringify(projection)).digest('hex');
}
