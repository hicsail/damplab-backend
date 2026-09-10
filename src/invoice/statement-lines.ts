/**
 * Turns a job's released SERVICE_LINE charges into the statement's `services`
 * array, in `InvoiceServiceLineItem` shape.
 *
 * The charge is authoritative for the money: `JobChargeService` writes a
 * SERVICE_LINE charge with the amount that stood when the line was released,
 * and that amount must never move again. A SOW can be re-countersigned after
 * a line has already been billed — the position's `cost` on the document can
 * change, a different service can even end up at that position — but the
 * customer was told a number and the statement has to keep saying it. So
 * `cost` and `name` always come from the charge (`amount`/`label`); only the
 * descriptive/pricing-breakdown fields (`description`, `category`, `unitCost`,
 * `multiplier`, `runCount`, `pricingDetails`) are read off the current
 * billable line at that position, and only when that line still names the
 * same service the charge was released against.
 */

export interface ReleasedChargeLike {
  serviceId?: string | null;
  label?: string | null;
  amount?: number | null;
  sourceIndex?: number | null;
}

export interface BillableLineLike {
  serviceId?: unknown;
  _id?: unknown;
  name?: unknown;
  description?: unknown;
  cost?: unknown;
  unitCost?: unknown;
  multiplier?: unknown;
  runCount?: unknown;
  category?: unknown;
  pricingDetails?: unknown;
}

export interface StatementServiceLine {
  _id: string;
  serviceId: string;
  name: string;
  description: string;
  cost: number;
  unitCost?: number;
  multiplier?: number;
  runCount?: number;
  category: string;
  pricingDetails?: unknown[];
  sourceIndex?: number;
}

function lineServiceId(line: BillableLineLike): string {
  return String(line.serviceId ?? line._id ?? '');
}

export function buildStatementServiceLines(charges: readonly ReleasedChargeLike[], lines: readonly BillableLineLike[]): StatementServiceLine[] {
  // Charges with no sourceIndex sort last, after everything positioned;
  // Array.prototype.sort is stable, so original arrival order is preserved
  // both among those and among ties.
  const ordered = [...charges].sort((a, b) => {
    const ai = a.sourceIndex ?? Number.POSITIVE_INFINITY;
    const bi = b.sourceIndex ?? Number.POSITIVE_INFINITY;
    return ai - bi;
  });

  return ordered.map((charge) => {
    const index = charge.sourceIndex;
    const candidate = index != null && index >= 0 ? lines[index] : undefined;
    const match = candidate && lineServiceId(candidate) === String(charge.serviceId ?? '') ? candidate : undefined;

    const serviceId = String(charge.serviceId ?? '');

    return {
      _id: serviceId,
      serviceId,
      name: String(charge.label ?? ''),
      description: match?.description == null ? '' : String(match.description),
      cost: Number(charge.amount) || 0,
      unitCost: match?.unitCost == null ? undefined : Number(match.unitCost),
      multiplier: match?.multiplier == null ? undefined : Number(match.multiplier),
      runCount: match?.runCount == null ? undefined : Number(match.runCount),
      category: match?.category == null ? '' : String(match.category),
      pricingDetails: Array.isArray(match?.pricingDetails) && (match!.pricingDetails as unknown[]).length > 0 ? (match!.pricingDetails as unknown[]) : undefined,
      sourceIndex: charge.sourceIndex == null ? undefined : charge.sourceIndex
    };
  });
}
