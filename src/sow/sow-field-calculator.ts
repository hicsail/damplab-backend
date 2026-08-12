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

function formatDate(value: Date | string | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  // Matches formatSOWDate in damplab-ui: month name, day, full year, in UTC so a
  // date-only value does not slip a day for readers west of Greenwich.
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function formatCurrency(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  // Sign goes outside the symbol: "-$47.00", not "$-47.00".
  const magnitude = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}$${magnitude}`;
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
    `Date of Agreement: ${formatDate(ctx.date)}`,
    '',
    'Operations Performed By:',
    'Trustees of Boston University',
    'DAMP Lab of Boston University',
    '610 Commonwealth Avenue',
    'Boston, MA 02215',
    '',
    `Operations Performed For: ${ctx.clientName ?? ''}`
  ];
  if (ctx.clientInstitution) lines.push(ctx.clientInstitution);
  if (ctx.clientAddress) lines.push(ctx.clientAddress);
  return lines.join('\n');
}

function buildPeriodOfPerformance(inputs: SowVersionInputs): string {
  const periods = (inputs.periods ?? []).filter((p) => p && p.startDate);
  if (periods.length === 0) return '';

  if (periods.length === 1) {
    const p = periods[0];
    return `The total turn-around time is estimated to be within ${p.durationDays} days from the start date. Therefore, the services herewith mentioned shall commence on ${formatDate(
      p.startDate
    )} and continue until ${formatDate(periodEndDate(p))}.`;
  }

  // Multiple periods may be non-consecutive or retroactive, so state each and
  // give the total rather than implying one continuous stretch.
  const rows = periods.map((p, i) => {
    const label = (p.label || '').trim() || `Period ${i + 1}`;
    return `${label}: ${p.durationDays} days, from ${formatDate(p.startDate)} through ${formatDate(periodEndDate(p))}`;
  });
  return ['The Operations shall be performed over the following periods:', bulletList(rows), `Total turn-around time is estimated to be ${totalDurationDays(periods)} days.`].join('\n');
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

  const serviceRows = (inputs.services ?? []).map((s) => `${s.name} — ${formatCurrency(s.cost)}`);
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
    allowsTextOverride: def.allowsTextOverride
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
        allowsTextOverride: def.allowsTextOverride
      });
      continue;
    }

    // allowsTextOverride is a property of the catalogue, not of stored data: if a
    // field becomes billing-backed later, any stale override must stop winning.
    const canOverride = def.allowsTextOverride;
    const isOverridden = canOverride && prev.isOverridden;

    merged.push({
      ...prev,
      label: def.label,
      kind: def.kind,
      order: def.order,
      allowsTextOverride: canOverride,
      calculatedValue: calculated,
      isOverridden,
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
export function normalizeIncomingFields(incoming: SowField[], inputs: SowVersionInputs, ctx: SowDocumentContext): SowField[] {
  const values = calculateFieldValues(inputs, ctx);
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
        allowsTextOverride: true
      });
      continue;
    }

    const def = findFieldDefinition(field.key);
    if (!def) continue; // unknown key: not in the catalogue and not custom

    const calculated = values[def.key] ?? '';
    const isOverridden = def.allowsTextOverride && (field.value ?? '') !== calculated;

    out.push({
      key: def.key,
      label: def.label,
      kind: def.kind,
      order: def.order,
      value: isOverridden ? field.value : calculated,
      calculatedValue: calculated,
      isOverridden,
      isEnabled: field.isEnabled !== false,
      allowsTextOverride: def.allowsTextOverride
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
      allowsTextOverride: def.allowsTextOverride
    });
  }

  return out.sort((a, b) => a.order - b.order);
}
