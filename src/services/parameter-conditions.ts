/**
 * "Show only if": a parameter may carry `showIf`, a condition on other
 * parameters of the same step. While it is false the parameter is hidden — not
 * asked, not required, not priced, not stored, not listed.
 *
 * Pure. Everything that reads a step's answers goes through here: pricing, the
 * answer gate, the parameter snapshot and both save paths.
 *
 * Mirrored in damplab-ui/src/utils/parameterConditions.ts. Keep the two in step:
 * the evaluator and the shared test vectors are the same on both sides.
 */
import { isOtherTextEntryId, otherTextParentId } from '../workflow/utils/other-option.util';

export type ConditionOp = 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'in' | 'includes';

export interface Comparison {
  parameterId: string;
  /** Present only for a qualified reference ("Set"."Parameter"). */
  parameterSetId?: string;
  op: ConditionOp;
  /** eq / ne / in on a dropdown controller. */
  optionIds?: string[];
  /** eq / ne on text, number, yes/no; gt..le; includes. */
  value?: string | number | boolean;
  /** in on a text or number controller. */
  values?: string[];
}

export type Condition = { all: Condition[] } | { any: Condition[] } | Comparison;

export const CONDITION_OPS: readonly ConditionOp[] = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'in', 'includes'];

type Param = Record<string, any>;

const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const isParam = (p: unknown): p is Param => isRecord(p) && typeof p.id === 'string';
const setOf = (p: Param): string => (p.fromParameterSetId ? String(p.fromParameterSetId) : '');
const isChoice = (p: Param): boolean => p.type === 'dropdown' || p.type === 'enum';
const NEVER_CONTROLS = new Set(['table', 'file', 'sampleSheet']);
const blank = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Ids the UI injects into formData and no catalog lists; they are never hidden.
 * Must stay in step with RUN_COUNT_PARAM_ID / EQUIPMENT_*_PARAM_ID in pricing/service-pricing.util.ts.
 */
const isReservedId = (id: string): boolean => id === '__runCount' || id.startsWith('__equip');

/** Answers by id, as saved: an array of { id, value } or an object keyed by id. Never collapses a multi-value answer. */
function answersById(formData: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (Array.isArray(formData)) {
    for (const entry of formData) if (isRecord(entry) && typeof entry.id === 'string') out.set(entry.id, entry.value);
  } else if (isRecord(formData)) {
    for (const [id, value] of Object.entries(formData)) out.set(id, value);
  }
  return out;
}

/** The answer as a list without blanks: `['']` (the form's empty multi-value placeholder) is no answer. */
const given = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]).filter((v) => !blank(v));

/** The effective parameter a comparison on `carrier` means, or undefined when it no longer resolves on this step. */
function controllerOf(comparison: Comparison, carrier: Param, params: readonly Param[]): Param | undefined {
  const wantedSet = typeof comparison.parameterSetId === 'string' && comparison.parameterSetId !== '' ? comparison.parameterSetId : setOf(carrier);
  return params.find((p) => p.id === comparison.parameterId && setOf(p) === wantedSet);
}

const isGroup = (c: unknown, key: 'all' | 'any'): c is Record<string, Condition[]> => isRecord(c) && Array.isArray(c[key]);

function comparisonsOf(condition: unknown, out: Comparison[] = []): Comparison[] {
  if (isGroup(condition, 'all')) for (const child of condition.all) comparisonsOf(child, out);
  else if (isGroup(condition, 'any')) for (const child of condition.any) comparisonsOf(child, out);
  else if (isRecord(condition) && typeof condition.parameterId === 'string') out.push(condition as Comparison);
  return out;
}

/** Parameters whose condition leads back to themselves. A cycle that reached storage shows every parameter on it (rule 13). */
function onCycle(params: readonly Param[]): Set<Param> {
  const deps = new Map<Param, Param[]>();
  for (const p of params) {
    deps.set(
      p,
      comparisonsOf(p.showIf)
        .map((c) => controllerOf(c, p, params))
        .filter((c): c is Param => c !== undefined)
    );
  }
  const cyclic = new Set<Param>();
  for (const start of params) {
    const seen = new Set<Param>();
    const queue = [...(deps.get(start) ?? [])];
    while (queue.length > 0) {
      const next = queue.pop()!;
      if (next === start) {
        cyclic.add(start);
        break;
      }
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...(deps.get(next) ?? []));
    }
  }
  return cyclic;
}

/**
 * Whether a stored comparison still makes sense for its controlling parameter
 * as it is now. A parameter whose answer format was changed after a condition
 * was written (a dropdown that became text, say) no longer fits a comparison
 * stored for the old format; that comparison is unresolved, not false, so the
 * parameter carrying it is shown rather than silently hidden for good.
 */
export function comparisonFits(comparison: Comparison, controller: Param): boolean {
  const { op } = comparison;
  if (typeof controller.type === 'string' && NEVER_CONTROLS.has(controller.type)) return false;
  const ordering = op === 'gt' || op === 'ge' || op === 'lt' || op === 'le';
  if (controller.type === 'boolean') return (op === 'eq' || op === 'ne') && typeof comparison.value === 'boolean';
  if (typeof comparison.value === 'boolean') return false;
  if (isChoice(controller)) return op === 'includes' ? typeof comparison.value === 'string' : !ordering && Array.isArray(comparison.optionIds);
  if (comparison.optionIds !== undefined) return false;
  // The operand the operator needs must be there: a missing one is malformed, so unresolved, not false.
  if (op === 'in') return Array.isArray(comparison.values);
  const hasValue = typeof comparison.value === 'string' || typeof comparison.value === 'number';
  if (controller.type === 'number') return op !== 'includes' && hasValue;
  return !ordering && hasValue;
}

const text = (v: unknown): string => String(v).trim().toLowerCase();

function compare(comparison: Comparison, controller: Param, value: unknown): boolean {
  const { op } = comparison;

  if (controller.type === 'boolean') {
    // A Yes/No that was never touched counts as false (rule 10).
    if (typeof comparison.value !== 'boolean') return false;
    const answer = value === true || value === 'true';
    if (op === 'eq') return answer === comparison.value;
    if (op === 'ne') return answer !== comparison.value;
    return false;
  }

  const answers = given(value);
  if (answers.length === 0) return false;
  if (typeof controller.type === 'string' && NEVER_CONTROLS.has(controller.type)) return false;

  if (isChoice(controller)) {
    const chosen = answers.map(String);
    if (op === 'includes') {
      if (typeof comparison.value !== 'string') return false;
      const needle = comparison.value.toLowerCase();
      const options: any[] = Array.isArray(controller.options) ? controller.options : [];
      return chosen.some((id) =>
        options.some(
          (o) =>
            o &&
            String(o.id) === id &&
            String(o.name ?? '')
              .toLowerCase()
              .includes(needle)
        )
      );
    }
    if (!Array.isArray(comparison.optionIds)) return false;
    const wanted = new Set(comparison.optionIds.map(String));
    const hit = chosen.some((id) => wanted.has(id));
    if (op === 'eq' || op === 'in') return hit;
    if (op === 'ne') return !hit;
    return false;
  }

  if (controller.type === 'number') {
    const numbers = answers.map((v) => (typeof v === 'number' ? v : Number(String(v).trim()))).filter((n) => Number.isFinite(n));
    if (numbers.length === 0) return false;
    if (op === 'in') {
      const wanted = (comparison.values ?? []).map((v) => Number(String(v).trim())).filter((n) => Number.isFinite(n));
      return numbers.some((n) => wanted.includes(n));
    }
    if (op === 'includes' || blank(comparison.value) || typeof comparison.value === 'boolean') return false;
    const target = Number(typeof comparison.value === 'string' ? comparison.value.trim() : comparison.value);
    if (!Number.isFinite(target)) return false;
    switch (op) {
      case 'eq':
        return numbers.some((n) => n === target);
      case 'ne':
        return !numbers.some((n) => n === target);
      case 'gt':
        return numbers.some((n) => n > target);
      case 'ge':
        return numbers.some((n) => n >= target);
      case 'lt':
        return numbers.some((n) => n < target);
      case 'le':
        return numbers.some((n) => n <= target);
    }
  }

  const texts = answers.filter((v) => typeof v !== 'object').map(text);
  if (texts.length === 0) return false;
  if (op === 'in') {
    const wanted = (comparison.values ?? []).map(text);
    return texts.some((t) => wanted.includes(t));
  }
  if (typeof comparison.value === 'boolean') return false;
  // Answered, and the target is blank: nothing equals it, so "is filled in" (!= "") holds; == and .includes stay false (rule 10).
  if (blank(comparison.value)) return op === 'ne';
  const target = text(comparison.value);
  if (op === 'eq') return texts.some((t) => t === target);
  if (op === 'ne') return !texts.some((t) => t === target);
  if (op === 'includes') return texts.some((t) => t.includes(target));
  return false;
}

/**
 * The ids of the step's parameters that are shown (rules 8–13).
 *
 * `effectiveParameters` is the step's effective list (own, then each set's, set
 * entries carrying `fromParameterSetId`); `formData` is that step's answers.
 */
export function visibleParameterIds(effectiveParameters: unknown, formData: unknown): Set<string> {
  const params: Param[] = Array.isArray(effectiveParameters) ? effectiveParameters.filter(isParam) : [];
  const answers = answersById(formData);
  const cyclic = onCycle(params);
  const memo = new Map<Param, boolean>();

  /** true / false, or null when a reference no longer resolves on this step (or no longer fits what it points at). */
  const evaluate = (condition: unknown, carrier: Param): boolean | null => {
    for (const key of ['all', 'any'] as const) {
      if (!isGroup(condition, key)) continue;
      // Every child is looked at: one unresolved reference makes the whole condition count as true.
      const results = condition[key].map((child) => evaluate(child, carrier));
      if (results.length === 0 || results.some((r) => r === null)) return null;
      return key === 'all' ? results.every((r) => r === true) : results.some((r) => r === true);
    }
    if (!isRecord(condition) || typeof condition.parameterId !== 'string' || !CONDITION_OPS.includes(condition.op)) return null;
    const comparison = condition as Comparison;
    const controller = controllerOf(comparison, carrier, params);
    if (!controller || !comparisonFits(comparison, controller)) return null;
    if (isChoice(controller) && Array.isArray(comparison.optionIds)) {
      const known = new Set((Array.isArray(controller.options) ? controller.options : []).map((o: any) => String(o?.id)));
      if (comparison.optionIds.some((id) => !known.has(String(id)))) return null;
    }
    // A hidden controller is unanswered, whatever is stored for it — Yes/No included.
    if (!visible(controller)) return false;
    return compare(comparison, controller, answers.get(controller.id));
  };

  const visible = (param: Param): boolean => {
    const known = memo.get(param);
    if (known !== undefined) return known;
    let result = true;
    if (param.showIf !== undefined && param.showIf !== null && !cyclic.has(param) && !isReservedId(param.id)) {
      result = evaluate(param.showIf, param) !== false;
    }
    memo.set(param, result);
    return result;
  };

  return new Set(params.filter(visible).map((p) => p.id));
}

/** The ids of the step's parameters that are hidden right now. An id the step does not list is never hidden. */
export function hiddenParameterIds(effectiveParameters: unknown, formData: unknown): Set<string> {
  const params: Param[] = Array.isArray(effectiveParameters) ? effectiveParameters.filter(isParam) : [];
  if (!params.some((p) => p.showIf !== undefined && p.showIf !== null)) return new Set();
  const visible = visibleParameterIds(params, formData);
  return new Set(params.map((p) => p.id).filter((id) => !visible.has(id)));
}

const isHiddenEntryId = (id: unknown, hidden: ReadonlySet<string>): boolean => typeof id === 'string' && (hidden.has(id) || (isOtherTextEntryId(id) && hidden.has(otherTextParentId(id))));

/** `formData` without the entries of hidden parameters and their `__otherText` companions. Same shape as given. */
export function withoutHiddenAnswers<T>(effectiveParameters: unknown, formData: T): T {
  const hidden = hiddenParameterIds(effectiveParameters, formData);
  if (hidden.size === 0) return formData;
  if (Array.isArray(formData)) return formData.filter((entry) => !(isRecord(entry) && isHiddenEntryId(entry.id, hidden))) as unknown as T;
  if (isRecord(formData)) return Object.fromEntries(Object.entries(formData).filter(([id]) => !isHiddenEntryId(id, hidden))) as unknown as T;
  return formData;
}

/**
 * Rule 17's exception, for a step that is in flight: `formData` (already without
 * hidden answers) with the stored entries of hidden parameters put back, so the
 * save carries them forward unchanged whatever the client sent.
 */
export function withStoredHiddenAnswers<E extends { id: string }>(effectiveParameters: unknown, formData: E[], stored: readonly E[]): E[] {
  const hidden = hiddenParameterIds(effectiveParameters, formData);
  if (hidden.size === 0) return formData;
  const present = new Set(formData.map((entry) => entry.id));
  return [...formData, ...stored.filter((entry) => isHiddenEntryId(entry.id, hidden) && !present.has(entry.id))];
}

// ---------------------------------------------------------------- definition check (rule 34)

const nonEmptyStrings = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s !== '');

/** What is wrong with the shape of a stored condition, or null. */
function shapeError(condition: unknown): string | null {
  if (!isRecord(condition)) return 'a condition must be an object';
  for (const key of ['all', 'any'] as const) {
    if (!(key in condition)) continue;
    const children = condition[key];
    if (!Array.isArray(children) || children.length === 0) return `“${key}” needs at least one condition`;
    if (Object.keys(condition).length !== 1) return `“${key}” cannot be mixed with other fields`;
    for (const child of children) {
      const error = shapeError(child);
      if (error) return error;
    }
    return null;
  }
  if (typeof condition.parameterId !== 'string' || condition.parameterId === '') return 'a comparison needs a parameterId';
  if (condition.parameterSetId !== undefined && (typeof condition.parameterSetId !== 'string' || condition.parameterSetId === '')) return 'parameterSetId must be a non-empty string';
  const op = condition.op as ConditionOp;
  if (!CONDITION_OPS.includes(op)) return `unknown operator “${String(condition.op)}”`;
  const has = (key: string): boolean => condition[key] !== undefined;
  const scalar = typeof condition.value === 'string' || typeof condition.value === 'number' || typeof condition.value === 'boolean';
  switch (op) {
    case 'eq':
    case 'ne':
      if (has('values')) return `“${op}” takes optionIds or a value`;
      if (has('optionIds') === has('value')) return `“${op}” takes exactly one of optionIds or value`;
      if (has('optionIds') ? !nonEmptyStrings(condition.optionIds) : !scalar) return `“${op}” has a value of the wrong shape`;
      return null;
    case 'in':
      if (has('value')) return '“in” takes optionIds or values';
      if (has('optionIds') === has('values')) return '“in” takes exactly one of optionIds or values';
      if (!nonEmptyStrings(has('optionIds') ? condition.optionIds : condition.values)) return '“in” needs a non-empty list';
      return null;
    case 'gt':
    case 'ge':
    case 'lt':
    case 'le':
      if (has('optionIds') || has('values')) return `“${op}” takes a number`;
      if (typeof condition.value !== 'number' || !Number.isFinite(condition.value)) return `“${op}” takes a number`;
      return null;
    case 'includes':
      if (has('optionIds') || has('values')) return '“includes” takes text';
      if (typeof condition.value !== 'string' || condition.value === '') return '“includes” takes text';
      return null;
  }
}

/**
 * Why a parameter's `showIf` may not be saved, or null (rule 34): it is not a
 * well-formed tree, it refers to itself, or it forms a cycle within `list` —
 * the list being saved (an operation's own parameters, or one set's). References
 * into other lists are not checked: the evaluator shows a parameter whose
 * reference does not resolve.
 */
export function conditionDefinitionError(parameter: unknown, list: unknown): string | null {
  if (!isRecord(parameter) || parameter.showIf === undefined || parameter.showIf === null) return null;
  const label = typeof parameter.name === 'string' && parameter.name.trim() !== '' ? parameter.name.trim() : String(parameter.id ?? '');
  const shape = shapeError(parameter.showIf);
  if (shape) return `Parameter “${label}”: “Show only if” is not a valid condition (${shape}).`;

  const siblings: Param[] = Array.isArray(list) ? list.filter(isParam) : [];
  /** Same-list references only: a qualified reference points into another list. */
  const sameListIds = (p: Param): string[] =>
    comparisonsOf(p.showIf)
      .filter((c) => c.parameterSetId === undefined)
      .map((c) => c.parameterId);
  const own = sameListIds(parameter as Param);
  if (own.includes(String(parameter.id))) return `Parameter “${label}”: “Show only if” cannot refer to the parameter itself.`;

  const byId = new Map(siblings.map((p) => [p.id, p] as const));
  const seen = new Set<string>();
  const queue = [...own];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (id === parameter.id) return `Parameter “${label}”: “Show only if” forms a loop with another parameter’s condition.`;
    if (seen.has(id)) continue;
    seen.add(id);
    const next = byId.get(id);
    if (next) queue.push(...sameListIds(next));
  }
  return null;
}
