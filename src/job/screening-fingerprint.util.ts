import { createHash } from 'crypto';
import { Job } from './job.model';
import { screeningStringsFromValue } from './job-screening.util';
import { fileRecord, flattenValues, isTableType, sampleSheetKeyOf } from '../workflow/utils/sample-sheet.util';

export interface ScreeningCustomerDetails {
  name: string;
  company: string;
  email: string | null;
}

export interface FlaggedAnswer {
  nodeId: string;
  paramId: string;
  values: unknown[];
  /** A Table's screening columns: they decide which of the file's columns a screen sends. */
  screeningFields?: string[];
}

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** The customer details a screen sends, read from the job alone: name falls back display name, username, email. */
export function screeningCustomerDetails(job: Pick<Job, 'clientDisplayName' | 'username' | 'email' | 'institute'>): ScreeningCustomerDetails {
  const email = trimmed(job.email);
  return {
    name: trimmed(job.clientDisplayName) || trimmed(job.username) || email,
    company: trimmed(job.institute),
    email: email || null
  };
}

/**
 * What a flagged parameter's stored answer contributes to the fingerprint; an empty array means
 * no value. Text is its trimmed strings. A Table is each file's key and filename, never its contents.
 */
export function flaggedAnswerValue(paramType: string, value: unknown): unknown[] {
  if (paramType === 'string') return screeningStringsFromValue(value);
  if (isTableType(paramType)) {
    return flattenValues(value)
      .filter((v) => v !== null && v !== undefined && v !== '')
      .map((v) => ({ key: sampleSheetKeyOf(v) ?? null, filename: fileRecord(v)?.filename ?? null }));
  }
  return [];
}

/** Trimmed, de-duplicated and sorted, so reordering the same columns is not a change. */
export function normalizeScreeningFields(fields: unknown): string[] {
  if (!Array.isArray(fields)) return [];
  return [
    ...new Set(
      fields
        .filter((f): f is string => typeof f === 'string')
        .map((f) => f.trim())
        .filter((f) => f !== '')
    )
  ].sort();
}

export function computeScreeningFingerprint(answers: FlaggedAnswer[], customer: ScreeningCustomerDetails): string {
  const sorted = [...answers].sort((a, b) => (a.nodeId < b.nodeId ? -1 : a.nodeId > b.nodeId ? 1 : a.paramId < b.paramId ? -1 : a.paramId > b.paramId ? 1 : 0));
  const canonical = JSON.stringify({
    answers: sorted.map(({ nodeId, paramId, values, screeningFields }) => ({ nodeId, paramId, values, screeningFields: normalizeScreeningFields(screeningFields) })),
    customer: { name: customer.name, company: customer.company, email: customer.email }
  });
  return createHash('sha256').update(canonical).digest('hex');
}
