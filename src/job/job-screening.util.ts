import { FormDataEntry, normalizeFormDataToArray } from '../workflow/utils/form-data.util';

export interface ScreeningTarget {
  /** Slice name sent to the provider; see job-screening-name.util. */
  name: string;
  seq: string;
  /** For people: `<service> › <parameter>[ › value <n> | › row <n> › <column> | › <filename> › <record name or "record <k>">]`. */
  label: string;
}

export interface ScreeningCollection {
  targets: ScreeningTarget[];
  /** Non-empty values not sent because they do not look like DNA. */
  skippedCount: number;
  /** What staff should know about the collection: a missing column, a file that could not be read. */
  notes: string[];
}

/** Every non-blank string a stored answer holds, trimmed, in order: a multi-value answer gives each value. */
export function screeningStringsFromValue(value: unknown): string[] {
  if (typeof value === 'string') {
    const t = value.trim();
    return t ? [t] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => (typeof item === 'string' && item.trim() !== '' ? [item.trim()] : []));
  return [];
}

/** A parameter the catalog marked `screening: true` (biosecurity-update). No key reads as false. */
export type FlaggedParam = { id: string; type: string; name?: string; allowMultipleValues?: boolean; screeningFields?: unknown };

export const isScreenedParameter = (param: unknown): param is FlaggedParam =>
  !!param && typeof param === 'object' && (param as { screening?: unknown }).screening === true && typeof (param as { id?: unknown }).id === 'string';

/** Comparison form: what makes two sequences the same sequence. */
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
  const entry = entries.find((x) => x.id === paramId);
  if (!entry) return null;
  return formValueToScreeningString(entry.value);
}

/**
 * A field holding something other than DNA — a note, a placeholder, a pasted
 * accession number — must not be sent to SecureDNA as if it were a sequence.
 * Requiring mostly-nucleotide content is a cheap guard against screening (and
 * storing) free text the customer typed into the wrong box.
 */
export function looksLikeNucleotideSequence(value: string): boolean {
  const normalized = normalizeSequenceString(value);
  if (normalized.length < 20) return false;
  const nucleotides = (normalized.match(/[ACGTUN]/g) ?? []).length;
  return nucleotides / normalized.length >= 0.9;
}

export { normalizeFormDataToArray };
