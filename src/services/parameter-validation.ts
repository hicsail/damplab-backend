/**
 * A Number parameter's validation: one stored string such as
 * `>0 && <100 && integer`. Pure — the editor, the upload, the client form and
 * the createJob gate all read it through here.
 *
 * Mirrored in damplab-ui/src/utils/parameterValidation.ts. Keep the two in step.
 */
export type ValidationRule = { kind: 'gt' | 'gte' | 'lt' | 'lte'; n: number } | { kind: 'integer' };
export type ParsedValidation = { rules: ValidationRule[] } | { error: string };

const COMPARISONS: Record<string, 'gt' | 'gte' | 'lt' | 'lte'> = { '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };
const COMPARISON = /^(>=|<=|>|<)(-?(?:\d+\.?\d*|\.\d+))$/;

export function parseValidation(text: unknown): ParsedValidation {
  const compact = String(text ?? '').replace(/\s+/g, '');
  if (compact === '') return { rules: [] };
  if (compact.includes('||')) return { error: '“||” is not supported — join rules with &&.' };
  const rules: ValidationRule[] = [];
  for (const token of compact.split('&&')) {
    if (token === '') return { error: 'A rule is missing next to “&&”.' };
    if (token.toLowerCase() === 'integer') {
      rules.push({ kind: 'integer' });
      continue;
    }
    const match = COMPARISON.exec(token);
    if (!match) return { error: `“${token}” is not a rule. Use >n, >=n, <n, <=n or integer.` };
    rules.push({ kind: COMPARISONS[match[1]], n: Number(match[2]) });
  }
  return { rules };
}

export function ruleMessage(rule: ValidationRule): string {
  switch (rule.kind) {
    case 'gt':
      return `Must be greater than ${rule.n}`;
    case 'gte':
      return `Must be at least ${rule.n}`;
    case 'lt':
      return `Must be less than ${rule.n}`;
    case 'lte':
      return `Must be at most ${rule.n}`;
    case 'integer':
      return 'Must be a whole number';
  }
}

function breaks(rule: ValidationRule, n: number): boolean {
  switch (rule.kind) {
    case 'gt':
      return !(n > rule.n);
    case 'gte':
      return !(n >= rule.n);
    case 'lt':
      return !(n < rule.n);
    case 'lte':
      return !(n <= rule.n);
    case 'integer':
      return !Number.isInteger(n);
  }
}

/** The first broken rule's message, or null. An empty value breaks nothing: "required" is a separate rule. */
export function checkValue(rules: ReadonlyArray<ValidationRule>, value: unknown): string | null {
  // A whitespace-only answer is an empty answer: Number('   ') is 0, which `<5` would accept and `>0` refuse.
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  if (rules.length === 0) return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return 'Must be a number';
  for (const rule of rules) if (breaks(rule, n)) return ruleMessage(rule);
  return null;
}

const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The stored validation, or the legacy rangeValueMin / rangeValueMax written the same way. */
export function effectiveValidation(param: unknown): string {
  const p = (param ?? {}) as { validation?: unknown; rangeValueMin?: unknown; rangeValueMax?: unknown };
  const own = typeof p.validation === 'string' ? p.validation.trim() : '';
  if (own) return own;
  const parts: string[] = [];
  const min = finite(p.rangeValueMin);
  const max = finite(p.rangeValueMax);
  if (min !== undefined) parts.push(`>=${min}`);
  if (max !== undefined) parts.push(`<=${max}`);
  return parts.join(' && ');
}

/** Why a parameter definition may not be saved, or null. Checks only the fields this module owns. */
export function parameterDefinitionError(param: unknown): string | null {
  if (!param || typeof param !== 'object') return null;
  const p = param as { id?: unknown; name?: unknown; type?: unknown; validation?: unknown; display?: unknown; allowMultipleValues?: unknown };
  const label = typeof p.name === 'string' && p.name.trim() !== '' ? p.name.trim() : String(p.id ?? '');
  const validation = typeof p.validation === 'string' ? p.validation.trim() : '';
  if (validation !== '') {
    if (p.type !== 'number') return `Parameter “${label}”: only Number parameters can have a validation.`;
    const parsed = parseValidation(validation);
    if ('error' in parsed) return `Parameter “${label}”: ${parsed.error}`;
  }
  if (p.display !== undefined && p.display !== null) {
    if (p.display !== 'checkboxes') return `Parameter “${label}”: unknown display “${String(p.display)}”.`;
    if (p.type !== 'dropdown' || p.allowMultipleValues !== true) return `Parameter “${label}”: “checkboxes” needs a dropdown that allows multiple values.`;
  }
  return null;
}
