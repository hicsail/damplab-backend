import { ParameterSnapshotEntry } from '../models/parameter-snapshot.model';
import { getMultiValueParamIds, normalizeFormDataToArray } from './form-data.util';
import { isEmptyParamValue } from '../../job-version/param-values.util';
import { SAMPLE_SHEET_PARAM_TYPE } from './sample-sheet.util';
import {
  EQUIPMENT_BOOKERS_PARAM_ID,
  EQUIPMENT_END_PARAM_ID,
  EQUIPMENT_HOURS_PER_WEEK_PARAM_ID,
  EQUIPMENT_OPEN_END_PARAM_ID,
  EQUIPMENT_START_PARAM_ID,
  RUN_COUNT_PARAM_ID
} from '../../pricing/service-pricing.util';

/** Names for ids the UI injects into formData and the catalogue never lists. Mirrors damplab-ui/src/utils/servicePricing.ts. */
const RESERVED_PARAM_NAMES: Readonly<Record<string, string>> = {
  [RUN_COUNT_PARAM_ID]: 'Number of runs',
  [EQUIPMENT_START_PARAM_ID]: 'Start Date',
  [EQUIPMENT_END_PARAM_ID]: 'End Date',
  [EQUIPMENT_OPEN_END_PARAM_ID]: 'Open End Date?',
  [EQUIPMENT_HOURS_PER_WEEK_PARAM_ID]: 'Projected Hours per Week',
  [EQUIPMENT_BOOKERS_PARAM_ID]: 'Authorized booker emails'
};

const OPTION_TYPES = new Set(['dropdown', 'enum']);
const FILE_TYPES = new Set(['file', SAMPLE_SHEET_PARAM_TYPE]);

interface ParamDef {
  id: string;
  name?: unknown;
  type?: unknown;
  options?: unknown;
}

function fileNameOf(value: unknown): string | undefined {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      // A bare, non-JSON string is a storage key at worst: show only its last path segment.
      const last = value.split('/').pop() ?? '';
      return last.trim() !== '' ? last : undefined;
    }
  }
  const name = parsed && typeof parsed === 'object' ? (parsed as { filename?: unknown }).filename : undefined;
  return typeof name === 'string' && name.trim() !== '' ? name : undefined;
}

function displayOne(param: ParamDef | undefined, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (param && typeof param.type === 'string' && FILE_TYPES.has(param.type)) return fileNameOf(value) ?? '[File attached]';
  if (param && typeof param.type === 'string' && OPTION_TYPES.has(param.type) && Array.isArray(param.options)) {
    const option = (param.options as Array<{ id?: unknown; name?: unknown }>).find((o) => o && String(o.id) === String(value));
    return option && typeof option.name === 'string' && option.name.trim() !== '' ? option.name : String(value);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function displayValueOf(param: ParamDef | undefined, value: unknown): string {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((v) => displayOne(param, v))
    .filter((s) => s !== '')
    .join(', ');
}

/**
 * The parameter snapshot for a node, taken from its service at write time.
 * One entry per saved value. An id the service no longer has keeps its
 * `previous` entry, so the first save after a catalogue edit does not erase the
 * name the snapshot exists to keep.
 */
export function buildParameterSnapshot(service: { parameters?: unknown } | null | undefined, formData: unknown, previous?: readonly ParameterSnapshotEntry[] | null): ParameterSnapshotEntry[] {
  const params: ParamDef[] = Array.isArray(service?.parameters) ? (service!.parameters as unknown[]).filter((p): p is ParamDef => !!p && typeof (p as ParamDef).id === 'string') : [];
  const byId = new Map(params.map((p) => [p.id, p]));
  const previousById = new Map((previous ?? []).filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]));
  const out: ParameterSnapshotEntry[] = [];

  // normalizeFormDataToArray collapses an array to its first element for any id not flagged
  // multi-value. The snapshot must show what was saved, so an id whose saved value is already an
  // array (a multi-select, or the UI-injected __equipBookers) counts as multi-value here.
  const multiIds = getMultiValueParamIds(params);
  if (Array.isArray(formData)) {
    for (const item of formData) {
      if (item && typeof item.id === 'string' && Array.isArray(item.value)) multiIds.add(item.id);
    }
  } else if (formData && typeof formData === 'object') {
    for (const [id, value] of Object.entries(formData)) if (Array.isArray(value)) multiIds.add(id);
  }

  for (const entry of normalizeFormDataToArray(formData, multiIds)) {
    if (isEmptyParamValue(entry.value)) continue;
    const param = byId.get(entry.id);
    if (param) {
      const name = typeof param.name === 'string' && param.name.trim() !== '' ? param.name : entry.id;
      out.push({ id: entry.id, name, type: typeof param.type === 'string' ? param.type : undefined, displayValue: displayValueOf(param, entry.value) });
      continue;
    }
    const prior = previousById.get(entry.id);
    if (prior) {
      out.push({ id: prior.id, name: prior.name, type: prior.type ?? undefined, displayValue: prior.displayValue });
      continue;
    }
    out.push({ id: entry.id, name: RESERVED_PARAM_NAMES[entry.id] ?? entry.id, type: undefined, displayValue: displayValueOf(undefined, entry.value) });
  }
  return out;
}
