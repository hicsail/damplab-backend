import { SowField, SowFieldKind, SowVersionInputs, SowPeriod } from './sow-version.model';
import { SOWAdjustmentType } from './sow.model';
import { CUSTOM_FIELD_ORDER_BASE, SOW_FIELD_CATALOG, SOW_PROSE_DEFAULTS, customerCategoryLabel, findFieldDefinition, isCustomFieldKey } from './sow-field-defaults';

/**
 * Generates the SOW document text from structured inputs.
 *
 * This runs server-side only. The frontend never composes document prose or
 * totals — it renders what this produces. Keeping one implementation is
 * deliberate: the pricing logic already exists twice (damplab-ui/src/utils/
 * servicePricing.ts and src/pricing/service-pricing.util.ts) and the copies
 * drifted far enough to break SOW saves outright, which is a mistake worth not
 * repeating for the document itself.
 *
 * Output is plain text. A line beginning "- " is a bullet; renderers (web and
 * PDF) agree on that and nothing else.
 */

export interface SowDocumentContext {
  sowNumber?: string;
  date?: Date;
  jobDisplayId?: string;
  jobName?: string;
  clientName?: string;
  clientEmail?: string;
  clientInstitution?: string;
  clientAddress?: string;
}

const DEFAULT_SOW_TITLE = 'Agreement to Perform Research Operations';

/** The lab's timezone. Every instant in the document reads in DAMP Lab local
 *  time, so a SOW says the same thing to a reader in Boston and one in Auckland. */
const LAB_TIME_ZONE = 'America/New_York';

/**
 * A period date is a *calendar day*, not an instant: it is stored as that day's
 * UTC midnight and must be read back the same way. Formatting it in the lab's
 * zone would slip it to the previous day — the whole point of the UTC anchor.
 * Matches sowDateToPickerValue/formatSOWDate in damplab-ui.
 */
function formatDate(value: Date | string | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * The lab's calendar day for an instant, encoded the way every period date is:
 * that day's UTC midnight. Use this whenever a real moment has to become a
 * calendar day — `new Date()` straight into a period start makes a SOW created
 * at 8pm in Boston claim it starts tomorrow.
 */
export function labCalendarDay(instant: Date = new Date()): Date {
  // en-CA formats as YYYY-MM-DD, which is exactly the anchor we need.
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: LAB_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * An instant — when something actually happened, e.g. the agreement date. Read
 * in the lab's zone, since that is the day it happened *here*.
 */
function formatInstant(value: Date | string | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: LAB_TIME_ZONE });
}

/** "1 day", not "1 days". */
function days(n: number): string {
  return `${n} ${n === 1 ? 'day' : 'days'}`;
}

function formatCurrency(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  // Sign goes outside the symbol: "-$47.00", not "$-47.00".
  const magnitude = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}$${magnitude}`;
}

/** A multiplier reads as "10", not "10.00" — but it is not always a whole
 *  number, so a fixed precision is wrong in the other direction too. */
function formatMultiplier(value: number): string {
  return String(Number(value.toFixed(4)));
}

export function periodEndDate(period: SowPeriod): Date {
  const start = period.startDate instanceof Date ? period.startDate : new Date(period.startDate);
  const end = new Date(start.getTime());
  // A 1-day period starts and ends the same day, so advance by duration - 1.
  end.setUTCDate(end.getUTCDate() + Math.max(0, (period.durationDays ?? 0) - 1));
  return end;
}

export function totalDurationDays(periods: SowPeriod[]): number {
  return (periods ?? []).reduce((sum, p) => sum + (Number.isFinite(p.durationDays) ? p.durationDays : 0), 0);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The true period of performance across possibly-non-consecutive periods: the
 * span from the earliest start date to the latest end date. Not the same as
 * summing each period's duration — that overcounts when periods are gapped and
 * undercounts (relative to the calendar span the prose describes) when they
 * overlap, and it is the start/end dates that the sentence actually promises.
 */
export function periodOfPerformanceSpan(periods: SowPeriod[]): { start: Date; end: Date; days: number } | null {
  const list = (periods ?? []).filter((p) => p && p.startDate);
  if (list.length === 0) return null;

  const starts = list.map((p) => (p.startDate instanceof Date ? p.startDate : new Date(p.startDate)));
  const ends = list.map((p) => periodEndDate(p));
  const start = new Date(Math.min(...starts.map((d) => d.getTime())));
  const end = new Date(Math.max(...ends.map((d) => d.getTime())));
  const days = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  return { start, end, days };
}

function bulletList(lines: string[]): string {
  return lines
    .filter((l) => l && l.trim() !== '')
    .map((l) => `- ${l.trim()}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Per-field generators
// ---------------------------------------------------------------------------

function buildTitle(inputs: SowVersionInputs, ctx: SowDocumentContext): string {
  const title = (inputs.sowTitle || '').trim() || DEFAULT_SOW_TITLE;
  const job = ctx.jobDisplayId ? `Job #${ctx.jobDisplayId} for ` : '';
  const client = ctx.clientName ? ` for ${ctx.clientName}` : '';
  return `${job}${title}${client}`;
}

function buildParties(ctx: SowDocumentContext): string {
  const lines = [
    `Date of Agreement: ${formatInstant(ctx.date)}`,
    '',
    'Operations Performed By:',
    'DAMP Lab',
    '610 Commonwealth Avenue',
    'Boston, MA 02215',
    '',
    `Operations Performed For: ${ctx.clientName ?? ''}`
  ];
  if (ctx.clientInstitution) lines.push(ctx.clientInstitution);
  // A job carries an institute but no separate address, so older SOWs stored the
  // institute in both fields. Printing it twice is never what was meant.
  const sameAsInstitution = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
  if (ctx.clientAddress && !sameAsInstitution(ctx.clientAddress, ctx.clientInstitution ?? '')) lines.push(ctx.clientAddress);
  return lines.join('\n');
}

function buildPeriodOfPerformance(inputs: SowVersionInputs): string {
  const periods = (inputs.periods ?? []).filter((p) => p && p.startDate);
  if (periods.length === 0) return '';

  // A one-day period starts and ends on the same date, so a range would name
  // that date twice. Say it once instead — here and in the bullets below.
  if (periods.length === 1) {
    const p = periods[0];
    if ((p.durationDays ?? 0) <= 1) {
      return `The total turn-around time is estimated to be a single day. Therefore, the services herewith mentioned shall be performed on ${formatDate(p.startDate)}.`;
    }
    return `The total turn-around time is estimated to be within ${days(p.durationDays)} from the start date. Therefore, the services herewith mentioned shall commence on ${formatDate(
      p.startDate
    )} and continue until ${formatDate(periodEndDate(p))}.`;
  }

  // Multiple periods may be non-consecutive or retroactive, so state each one,
  // then give the true period of performance: the span from the earliest start
  // to the latest end, not the sum of each period's working days.
  const rows = periods.map((p, i) => {
    const label = (p.label || '').trim() || `Period ${i + 1}`;
    if ((p.durationDays ?? 0) <= 1) return `${label}: 1 day, on ${formatDate(p.startDate)}`;
    return `${label}: ${days(p.durationDays)}, from ${formatDate(p.startDate)} through ${formatDate(periodEndDate(p))}`;
  });
  const span = periodOfPerformanceSpan(periods);
  const summary = span
    ? span.days <= 1
      ? `The overall period of performance is estimated to be a single day, on ${formatDate(span.start)}.`
      : `The overall period of performance is estimated to be ${days(span.days)}, from ${formatDate(span.start)} through ${formatDate(span.end)}.`
    : '';
  return ['The Operations shall be performed over the following periods:', bulletList(rows), summary].join('\n');
}

function buildEngagementResources(inputs: SowVersionInputs): string {
  const people: string[] = [];
  if ((inputs.projectManager || '').trim()) people.push(`${inputs.projectManager.trim()} – Project Manager`);
  if ((inputs.projectLead || '').trim()) people.push(`${inputs.projectLead.trim()} – Project Lead`);
  if (people.length === 0) return '';
  return ['The Operations contemplated by this SOW shall be performed by the DAMP team, which shall include the following individuals:', bulletList(people)].join('\n');
}

function buildFeeSchedule(inputs: SowVersionInputs): string {
  const lines: string[] = [
    'This engagement will be conducted on a Project basis. The total value for the Operations pursuant to this SOW is presented below.',
    '',
    `Pricing category: ${customerCategoryLabel(inputs.customerCategory)}`,
    ''
  ];

  const serviceRows = (inputs.services ?? []).map((s) => {
    const multiplier = Number(s.multiplier);
    // A line written before unit prices were recorded has only its total to
    // quote. Deriving a base by dividing the total would rewrite the figures on
    // documents that are already sent, signed or finalized — every load
    // regenerates this text (see mergeCalculatedFields) and Fee Schedule has no
    // text override to fall back on.
    if (s.unitCost == null || !Number.isFinite(multiplier) || multiplier === 1) {
      return `${s.name} — ${formatCurrency(s.cost)}`;
    }
    return `${s.name} — ${formatCurrency(s.unitCost)} x ${formatMultiplier(multiplier)} = ${formatCurrency(s.cost)}`;
  });
  lines.push(...(serviceRows.length ? [bulletList(serviceRows)] : ['- No services listed']));

  const adjustments = inputs.adjustments ?? [];
  if (adjustments.length > 0) {
    const adjRows = adjustments.map((a) => {
      const desc = (a.description || '').trim() || (a.type === SOWAdjustmentType.DISCOUNT ? 'Discount' : 'Additional cost');
      const reason = (a.reason || '').trim();
      const label = reason ? `${desc} — ${reason}` : desc;
      const signed = a.type === SOWAdjustmentType.DISCOUNT ? -Math.abs(a.amount) : Math.abs(a.amount);
      return `${label}: ${formatCurrency(signed)}`;
    });
    lines.push(bulletList(adjRows));
  }

  lines.push(
    '',
    `Total: ${formatCurrency(inputs.totalCost)}`,
    '',
    'Upon completion of the initial performance period, University and the Client will have the option to renew this SOW for an additional then-stated project for those resources identified.'
  );
  return lines.join('\n');
}

function calculatedValueFor(key: string, inputs: SowVersionInputs, ctx: SowDocumentContext): string {
  switch (key) {
    case 'sowTitle':
      return buildTitle(inputs, ctx);
    case 'parties':
      return buildParties(ctx);
    case 'periodOfPerformance':
      return buildPeriodOfPerformance(inputs);
    case 'engagementResources':
      return buildEngagementResources(inputs);
    case 'scopeOfWork':
      return bulletList(inputs.scopeOfWork ?? []);
    case 'deliverables':
      return bulletList(inputs.deliverables ?? []);
    case 'feeSchedule':
      return buildFeeSchedule(inputs);
    default:
      return SOW_PROSE_DEFAULTS[key] ?? '';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The generated value of every catalogue field, keyed by field key. This is what
 * the preview query returns: only what the server owns. The client keeps its own
 * `value` / `isOverridden` / `isEnabled`, which may include unsaved edits the
 * server has never seen, so returning whole rows here would clobber them.
 */
export function calculateFieldValues(inputs: SowVersionInputs, ctx: SowDocumentContext): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of SOW_FIELD_CATALOG) {
    out[def.key] = calculatedValueFor(def.key, inputs, ctx);
  }
  return out;
}

/**
 * A fresh document: every catalogue field at its generated value, nothing
 * overridden. Used when a SOW gets its first version.
 */
export function buildCalculatedFields(inputs: SowVersionInputs, ctx: SowDocumentContext): SowField[] {
  const values = calculateFieldValues(inputs, ctx);
  return SOW_FIELD_CATALOG.map((def) => ({
    key: def.key,
    label: def.label,
    kind: def.kind,
    order: def.order,
    value: values[def.key] ?? '',
    calculatedValue: values[def.key] ?? '',
    isOverridden: false,
    // A section with nothing in it would render as a bare heading.
    isEnabled: def.enabledByDefault && (values[def.key] ?? '').trim() !== '',
    allowsTextOverride: def.allowsTextOverride,
    allowsEmpty: def.allowsEmpty,
    requiresInitials: false
  }));
}

/**
 * Refreshes generated text over an existing document, preserving staff intent.
 *
 * Overridden fields keep their text but get a current `calculatedValue`, so
 * "revert to calculated" lands on today's value rather than the one from
 * whenever the override was made. Fields the staff disabled stay disabled.
 * Custom fields pass through untouched — nothing generates them.
 */
export function mergeCalculatedFields(previous: SowField[], inputs: SowVersionInputs, ctx: SowDocumentContext): SowField[] {
  const values = calculateFieldValues(inputs, ctx);
  const byKey = new Map(previous.map((f) => [f.key, f]));
  const merged: SowField[] = [];

  for (const def of SOW_FIELD_CATALOG) {
    const prev = byKey.get(def.key);
    const calculated = values[def.key] ?? '';

    if (!prev) {
      // A section added to the catalogue after this version was written.
      merged.push({
        key: def.key,
        label: def.label,
        kind: def.kind,
        order: def.order,
        value: calculated,
        calculatedValue: calculated,
        isOverridden: false,
        isEnabled: def.enabledByDefault && calculated.trim() !== '',
        allowsTextOverride: def.allowsTextOverride,
        allowsEmpty: def.allowsEmpty,
        requiresInitials: false
      });
      continue;
    }

    // allowsTextOverride is a property of the catalogue, not of stored data: if a
    // field becomes billing-backed later, any stale override must stop winning.
    const canOverride = def.allowsTextOverride;
    const isOverridden = canOverride && prev.isOverridden;

    // A required field that was hidden only because it had nothing to say gets a
    // second chance to show itself once content arrives — otherwise it stays
    // hidden forever after the first empty save, with no visible way to notice.
    // A field the staff hid while it already had content is left alone.
    const wasEmptyAndRequired = def.allowsEmpty === false && (prev.calculatedValue ?? '').trim() === '';
    const justPopulated = wasEmptyAndRequired && calculated.trim() !== '';

    merged.push({
      ...prev,
      label: def.label,
      kind: def.kind,
      order: def.order,
      allowsTextOverride: canOverride,
      allowsEmpty: def.allowsEmpty,
      calculatedValue: calculated,
      isOverridden,
      isEnabled: prev.isEnabled || justPopulated,
      value: isOverridden ? prev.value : calculated
    });
  }

  // Custom fields keep their relative order after the catalogue.
  const customs = previous.filter((f) => isCustomFieldKey(f.key)).map((f, i) => ({ ...f, kind: SowFieldKind.CUSTOM, order: CUSTOM_FIELD_ORDER_BASE + i, allowsTextOverride: true }));

  return [...merged, ...customs].sort((a, b) => a.order - b.order);
}

/**
 * Normalizes fields arriving from a client before they are frozen into a version.
 * Labels, kinds, order and override permission come from the catalogue rather
 * than the request, so a caller cannot relabel a section, reorder the document,
 * or grant itself a text override on Fee Schedule.
 */
export function normalizeIncomingFields(incoming: SowField[], inputs: SowVersionInputs, ctx: SowDocumentContext, previousFields: SowField[] = []): SowField[] {
  const values = calculateFieldValues(inputs, ctx);
  const prevByKey = new Map(previousFields.map((f) => [f.key, f]));
  const seen = new Set<string>();
  const out: SowField[] = [];

  for (const field of incoming ?? []) {
    if (!field?.key || seen.has(field.key)) continue;
    seen.add(field.key);

    if (isCustomFieldKey(field.key)) {
      out.push({
        key: field.key,
        label: (field.label || '').trim() || 'Untitled section',
        kind: SowFieldKind.CUSTOM,
        order: CUSTOM_FIELD_ORDER_BASE + out.filter((f) => isCustomFieldKey(f.key)).length,
        value: field.value ?? '',
        calculatedValue: undefined,
        isOverridden: false,
        isEnabled: field.isEnabled !== false,
        allowsTextOverride: true,
        allowsEmpty: true,
        requiresInitials: field.requiresInitials === true
      });
      continue;
    }

    const def = findFieldDefinition(field.key);
    if (!def) continue; // unknown key: not in the catalogue and not custom

    const calculated = values[def.key] ?? '';
    const isOverridden = def.allowsTextOverride && (field.value ?? '') !== calculated;

    // A required field the client sent as hidden gets shown again if it was
    // hidden only for lack of content and now has some — see mergeCalculatedFields
    // for why this doesn't resurrect a field staff hid deliberately.
    const prev = prevByKey.get(def.key);
    const wasEmptyAndRequired = def.allowsEmpty === false && (prev?.calculatedValue ?? '').trim() === '';
    const justPopulated = wasEmptyAndRequired && calculated.trim() !== '';

    out.push({
      key: def.key,
      label: def.label,
      kind: def.kind,
      order: def.order,
      value: isOverridden ? field.value : calculated,
      calculatedValue: calculated,
      isOverridden,
      isEnabled: field.isEnabled !== false || justPopulated,
      allowsTextOverride: def.allowsTextOverride,
      allowsEmpty: def.allowsEmpty,
      requiresInitials: field.requiresInitials === true
    });
  }

  // Any catalogue field the client omitted is restored at its generated value and
  // disabled, so a partial request cannot silently drop a section of the contract.
  for (const def of SOW_FIELD_CATALOG) {
    if (seen.has(def.key)) continue;
    const calculated = values[def.key] ?? '';
    out.push({
      key: def.key,
      label: def.label,
      kind: def.kind,
      order: def.order,
      value: calculated,
      calculatedValue: calculated,
      isOverridden: false,
      isEnabled: false,
      allowsTextOverride: def.allowsTextOverride,
      allowsEmpty: def.allowsEmpty,
      requiresInitials: false
    });
  }

  return out.sort((a, b) => a.order - b.order);
}
