/** Money rounding — keeps prorated adjustments from carrying float noise onto an invoice. */
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export interface RawSowAdjustment {
  type?: unknown;
  description?: unknown;
  reason?: unknown;
  amount?: unknown;
}

export interface ProratedAdjustment {
  type: string;
  description: string;
  reason?: string;
  amount: number;
  appliedAmount: number;
  prorationFactor: number;
}

/**
 * This invoice's share of the SOW's base cost, as a factor in [0, 1].
 *
 * Adjustments are fixed dollar amounts against the WHOLE job, but an invoice
 * may cover only some of its services, and a job can legitimately be billed
 * across several invoices. Applying the full amount to each would credit a
 * discount more than once, so prorate by this invoice's share of the SOW
 * base cost. Every invoice for a job then sums to the SOW total, independent
 * of how the services were split up or the order of generation.
 */
export function prorationFactorFor(billed: number, sowSubtotal: number): number {
  return sowSubtotal > 0 ? Math.min(1, billed / sowSubtotal) : 0;
}

/**
 * Carry the SOW's pricing adjustments onto an invoice, scaled by `factor`.
 *
 * Uses the stored amount, never a unitAmount x multiplier recomputation:
 * buildFeeSchedule words a breakdown, but an invoice bills the stored
 * figure, and switching would move totals on invoices already issued.
 */
export function prorateAdjustments(raw: readonly RawSowAdjustment[] | null | undefined, factor: number): ProratedAdjustment[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.map((adj) => {
    const type = String(adj?.type ?? '');
    const amount = Number(adj?.amount) || 0;
    // Sign matches SOWService.calculateAdjustmentsTotal: DISCOUNT subtracts,
    // ADDITIONAL_COST adds, SPECIAL_TERM is a note with no monetary effect.
    const signed = type === 'DISCOUNT' ? -amount : type === 'ADDITIONAL_COST' ? amount : 0;
    return {
      type,
      description: String(adj?.description ?? ''),
      reason: adj?.reason ? String(adj.reason) : undefined,
      amount,
      appliedAmount: round2(signed * factor),
      // 4dp, not 2: rounding the factor to cents would show two different
      // partials as an identical "0.5", and a genuine 0.997 would round to 1
      // and read as a full-job invoice.
      prorationFactor: Math.round(factor * 10000) / 10000
    };
  });
}

/** Sums the applied amounts and rounds once. */
export function appliedAdjustmentsTotal(adjustments: readonly ProratedAdjustment[]): number {
  return round2(adjustments.reduce((sum, a) => sum + a.appliedAmount, 0));
}
