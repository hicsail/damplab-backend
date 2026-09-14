/**
 * Screening slice names: `<workflowMongoId>_<nodeGraphId>_<fieldId>`.
 *
 * The workflow id is 24-char hex and the field id is a known literal, which is
 * what makes the node id in the middle unambiguous even though it may itself
 * contain underscores.
 */
const SLICE_NAME_PATTERN = /^([a-fA-F0-9]{24})_(.+)_((?:insert|vector))$/;

export function screeningSliceName(workflowId: string, nodeId: string, fieldId: string): string {
  return `${workflowId}_${nodeId}_${fieldId}`;
}

export function parseScreeningSliceName(sliceName: string): { workflowId: string; nodeId: string; fieldId: string } | null {
  const m = sliceName.match(SLICE_NAME_PATTERN);
  if (!m) return null;
  return { workflowId: m[1], nodeId: m[2], fieldId: m[3] };
}
