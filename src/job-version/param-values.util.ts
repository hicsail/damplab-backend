import { RUN_COUNT_PARAM_ID } from '../pricing/service-pricing.util';

/**
 * Comparing the parameter values on a workflow node.
 *
 * Used by `parametersDiffer` to decide whether a save actually changed anything
 * a node's in-flight lab work depends on. The comparison has to be semantic
 * rather than structural: the editor resubmits the current catalogue's whole
 * parameter list, so parameters added since submission arrive empty, and a
 * number typed into a text field comes back as a string.
 */

/** True for a value that carries no information. */
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

/** Canonical string form, so nested object key order is not a difference. */
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
