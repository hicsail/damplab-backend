/**
 * Utilities for workflow node formData. formData has a single canonical shape:
 * an array of parameter objects { id, value }. Multi-value parameters use value: string[].
 */

/**
 * Canonical shape for one formData parameter. formData is always an array of these.
 */
export interface FormDataEntry {
  id: string;
  value: string | number | boolean | string[] | null;
}

/**
 * Returns the set of parameter ids that allow multiple values.
 */
export function getMultiValueParamIds(parameters: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(parameters)) return ids;
  for (const param of parameters) {
    if (param && typeof param === 'object' && (param as { allowMultipleValues?: boolean }).allowMultipleValues === true) {
      const id = (param as { id?: string }).id;
      if (typeof id === 'string') ids.add(id);
    }
  }
  return ids;
}

function ensureArrayValue(val: unknown, paramId: string, multiValueParamIds: Set<string>): string | number | boolean | string[] | null {
  const isMulti = multiValueParamIds.has(paramId);
  if (val === undefined || val === null) return isMulti ? [] : null;
  if (isMulti) return Array.isArray(val) ? (val as string[]) : [val as string];
  return Array.isArray(val) ? (val.length ? (val[0] as string) : null) : (val as string | number | boolean);
}

/**
 * Converts formData (object keyed by param id, or array of { id, value }) to the canonical
 * array shape. Multi-value params get value as string[]; others stay single value.
 * Use for both saving (normalize input then store array) and loading (normalize stored then return array).
 */
export function normalizeFormDataToArray(
  input: unknown,
  multiValueParamIds: Set<string>
): FormDataEntry[] {
  if (input == null) return [];

  // Already array of entries
  if (Array.isArray(input)) {
    return input
      .filter((item): item is { id: string; value?: unknown } => item != null && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
      .map((item) => ({
        id: item.id,
        value: ensureArrayValue(item.value, item.id, multiValueParamIds)
      }));
  }

  // Legacy or input object keyed by param id
  if (typeof input === 'object' && !Array.isArray(input)) {
    return Object.entries(input).map(([id, value]) => ({
      id,
      value: ensureArrayValue(value, id, multiValueParamIds)
    }));
  }

  return [];
}
