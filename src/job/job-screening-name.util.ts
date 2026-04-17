/**
 * Parse slice name produced by job screening: `<mongoWorkflowId>_<nodeGraphId>_<fieldId>`.
 * `fieldId` is `insert` or `vector`; workflow id is 24-char hex.
 */
export function parseScreeningSliceName(sliceName: string): { workflowId: string; nodeId: string; fieldId: string } | null {
  const m = sliceName.match(/^([a-fA-F0-9]{24})_(.+)_((?:insert|vector))$/);
  if (!m) return null;
  return { workflowId: m[1], nodeId: m[2], fieldId: m[3] };
}
