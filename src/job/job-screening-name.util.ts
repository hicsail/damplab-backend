/**
 * Screening slice names: the `name` each sequence is sent to Aclid and SecureDNA under, and the
 * key Aclid's per-sequence details come back under. Unique within one job's screen (Aclid
 * requires it; at most 200 characters).
 *
 *   text:              <workflowId>_<nodeId>_<paramId>
 *   multi-value text:  <workflowId>_<nodeId>_<paramId>_v<n>                (n from 1)
 *   table cell:        <workflowId>_<nodeId>_<paramId>_r<row>_<columnSlug>  (row = data row, from 1)
 *
 * Nothing parses these back: a screening run stores each name beside its human label.
 * (The old parser recognised only `insert`/`vector` and had no caller — F1.)
 */
export function screeningSliceName(workflowId: string, nodeId: string, paramId: string): string {
  return `${workflowId}_${nodeId}_${paramId}`;
}

export function multiValueSliceName(workflowId: string, nodeId: string, paramId: string, n: number): string {
  return `${screeningSliceName(workflowId, nodeId, paramId)}_v${n}`;
}

export function tableCellSliceName(workflowId: string, nodeId: string, paramId: string, row: number, columnSlug: string): string {
  return `${screeningSliceName(workflowId, nodeId, paramId)}_r${row}_${columnSlug}`;
}

const slug = (header: string): string =>
  header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '') || 'col';

/** One slug per header, in order; a repeat gets `-2`, `-3`. */
export function columnSlugs(headers: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header) => {
    const base = slug(header);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}
