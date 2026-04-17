import { FormDataEntry, normalizeFormDataToArray } from '../workflow/utils/form-data.util';

export interface ScreeningTarget {
  /** MPI / batch slice name: `<workflowMongoId>_<nodeGraphId>_<fieldId>` */
  name: string;
  seq: string;
}

export function normalizeSequenceString(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, '');
}

function formValueToScreeningString(value: FormDataEntry['value']): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length ? t : null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim() || null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) return item.trim();
    }
    return null;
  }
  return null;
}

export function getFormStringFromEntries(entries: FormDataEntry[], paramId: string): string | null {
  const e = entries.find((x) => x.id === paramId);
  if (!e) return null;
  return formValueToScreeningString(e.value);
}

export { normalizeFormDataToArray };
