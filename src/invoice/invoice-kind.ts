import { registerEnumType } from '@nestjs/graphql';

export enum InvoiceKind {
  /** Bills service lines from the job's Statement of Work. */
  SOW = 'SOW',
  /** A running statement of the job's confirmed equipment usage, payments and balance. */
  EQUIPMENT = 'EQUIPMENT'
}
registerEnumType(InvoiceKind, { name: 'InvoiceKind', description: 'What an invoice bills.' });

/**
 * An invoice's kind, with the legacy fallback in one place.
 *
 * Every invoice written before this field existed bills SOW service lines, so
 * an absent `kind` reads as SOW. This is a READ-TIME fallback rather than a
 * schema default deliberately: a default only reaches documents Mongoose
 * hydrates, and the billed-positions guard, the resolver and the UI must all
 * agree about a `.lean()` row and a projected one too.
 *
 * Anything unrecognised also reads as SOW — the safe direction, since EQUIPMENT
 * is what exempts an invoice from the double-billing guard.
 */
export function invoiceKindOf(invoice: { kind?: string | null } | null | undefined): InvoiceKind {
  return String(invoice?.kind ?? '') === InvoiceKind.EQUIPMENT ? InvoiceKind.EQUIPMENT : InvoiceKind.SOW;
}
