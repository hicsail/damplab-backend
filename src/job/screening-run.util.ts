import { ScreeningRunAclidLeg } from './screening-run.model';

/** Half of Mongo's 16 MB document limit, leaving room for the rest of the run. */
export const SCREENING_RUN_ACLID_MAX_BYTES = 8 * 1024 * 1024;

const sizeOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');

/**
 * The Aclid leg as it can be stored. A plate of a few hundred sequences with 25 matches each
 * can approach Mongo's limit, and a refused write would leave the run In Progress forever. So:
 * past the bound, `raw.sequences` (Aclid's copy of the per-sequence map) goes first, then the
 * details themselves, with a detail saying so. The verdict fields are never touched.
 */
export function fitAclidLeg(leg: ScreeningRunAclidLeg, maxBytes: number = SCREENING_RUN_ACLID_MAX_BYTES): ScreeningRunAclidLeg {
  if (sizeOf(leg.raw) + sizeOf(leg.details) <= maxBytes) return leg;
  let fitted: ScreeningRunAclidLeg = leg;
  if (leg.raw && typeof leg.raw === 'object' && 'sequences' in leg.raw) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { sequences, ...rest } = leg.raw as Record<string, unknown>;
    fitted = { ...fitted, raw: rest };
    if (sizeOf(fitted.raw) + sizeOf(fitted.details) <= maxBytes) return fitted;
  }
  const note = 'Aclid details too large to store';
  return { ...fitted, details: null, detail: fitted.detail ? `${fitted.detail}; ${note}` : note };
}
