import { readEquipmentWindow } from '../booking/equipment-window';
import { dateOnlyToUtcMs } from '../pricing/service-pricing.util';
import { SowPeriod } from './sow-version.model';

/** Default project length when the job gives no better dates; staff edit it in the editor. */
export const DEFAULT_SEED_DURATION_DAYS = 14;

const DAY_MS = 86_400_000;

/** What the seed reads off each service line: its name, and the node's formData. */
export interface SeedService {
  name: string;
  formData?: unknown;
}

/**
 * The opening periods for a new SOW.
 *
 * Every Equipment Use operation already carries the dates the client asked for
 * (`__equipStart` / `__equipEnd`), so the first draft states those instead of
 * making staff retype them. One period per operation, labelled with its name.
 * Operations are never merged, even when two share a window and a name: they
 * came from separate operations (human, 2026-10-27). A job with no Equipment
 * Use opens today for 14 days, as it always has.
 *
 * `__equipOpenEnd` is deliberately not read (human, 2026-10-08): an open-ended
 * operation still has an estimated end, and that is what the SOW promises.
 *
 * All dates are calendar days encoded as UTC midnight, like every period date.
 */
export function equipmentSeedPeriods(services: SeedService[], today: Date): SowPeriod[] {
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const windows: Array<{ startMs: number; endMs: number; name: string; order: number }> = [];

  (services ?? []).forEach((service, order) => {
    const window = readEquipmentWindow(service.formData);
    // A service is Equipment Use only if it yields a valid start or end date.
    if (window.start === undefined && window.end === undefined) return;

    const startMs = dateOnlyToUtcMs(window.start) ?? todayMs;
    const givenEndMs = dateOnlyToUtcMs(window.end);
    const endMs = givenEndMs !== undefined && givenEndMs >= startMs ? givenEndMs : startMs + (DEFAULT_SEED_DURATION_DAYS - 1) * DAY_MS;

    windows.push({ startMs, endMs, name: service.name, order });
  });

  if (windows.length === 0) {
    return [{ startDate: new Date(todayMs), durationDays: DEFAULT_SEED_DURATION_DAYS, label: undefined }];
  }

  // Start, then end, then job order — the last made explicit rather than left
  // to sort stability, because identical windows are expected here.
  return windows
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.order - b.order)
    .map((w) => ({
      startDate: new Date(w.startMs),
      durationDays: Math.round((w.endMs - w.startMs) / DAY_MS) + 1,
      label: w.name
    }));
}
