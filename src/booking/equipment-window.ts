import { normalizeFormDataToArray } from '../workflow/utils/form-data.util';
import {
  EQUIPMENT_BOOKERS_PARAM_ID,
  EQUIPMENT_END_PARAM_ID,
  EQUIPMENT_HOURS_PER_WEEK_PARAM_ID,
  EQUIPMENT_OPEN_END_PARAM_ID,
  EQUIPMENT_START_PARAM_ID,
  dateOnlyToUtcMs
} from '../pricing/service-pricing.util';
import { normalizeBookerEmails } from './booker-emails';

/** The estimated window as the canvas recorded it: two date-only strings and a flag. */
export interface EquipmentWindow {
  start?: string;
  end?: string;
  openEnd: boolean;
}

const DAY_MS = 86_400_000;

const byId = (rawFormData: unknown): Map<string, unknown> => {
  const entries = normalizeFormDataToArray(rawFormData, new Set([EQUIPMENT_BOOKERS_PARAM_ID]));
  return new Map(entries.map((entry) => [entry.id, entry.value]));
};

const asDateOnly = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return dateOnlyToUtcMs(trimmed) === undefined ? undefined : trimmed;
};

export function readEquipmentWindow(rawFormData: unknown): EquipmentWindow {
  const values = byId(rawFormData);
  const openEnd = values.get(EQUIPMENT_OPEN_END_PARAM_ID);
  return {
    start: asDateOnly(values.get(EQUIPMENT_START_PARAM_ID)),
    end: asDateOnly(values.get(EQUIPMENT_END_PARAM_ID)),
    // Stored either as a real boolean or as the string a checkbox round-tripped.
    openEnd: openEnd === true || openEnd === 'true'
  };
}

export function readEquipmentHoursPerWeek(rawFormData: unknown): number | undefined {
  const raw = byId(rawFormData).get(EQUIPMENT_HOURS_PER_WEEK_PARAM_ID);
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function readEquipmentBookers(rawFormData: unknown): string[] {
  return normalizeBookerEmails(byId(rawFormData).get(EQUIPMENT_BOOKERS_PARAM_ID));
}

/**
 * Whether a booked slot falls outside the operation's estimated window.
 *
 * The two sides use different time models and this is where they meet: the window
 * is two date-only strings read as UTC midnight, the slot is a real datetime. The
 * end date is INCLUSIVE, so the window closes at midnight UTC *following* it —
 * without the extra day, a booking on the final afternoon of the window would be
 * flagged as outside it.
 *
 * A missing or malformed date disables that side of the comparison rather than
 * failing closed: this only drives an amber warning, never a refusal.
 */
export function isOutsideWindow(window: EquipmentWindow, startTime: Date, endTime: Date): boolean {
  const startMs = dateOnlyToUtcMs(window.start);
  if (startMs !== undefined && startTime.getTime() < startMs) return true;
  if (window.openEnd) return false;
  const endMs = dateOnlyToUtcMs(window.end);
  if (endMs !== undefined && endTime.getTime() > endMs + DAY_MS) return true;
  return false;
}
