import { registerEnumType } from '@nestjs/graphql';

export enum InvoiceKind {
  /** Bills service lines from the job's Statement of Work. */
  SOW = 'SOW',
  /** A running statement of the job's confirmed equipment usage, payments and balance. */
  EQUIPMENT = 'EQUIPMENT',
  /** A statement of everything the job has been charged, less what it has paid. Every new invoice is one. */
  STATEMENT = 'STATEMENT'
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
 * is what exempts an invoice from the double-billing guard (see
 * `InvoiceService.createForJob`'s prior-invoice scan). STATEMENT is not wired
 * into that guard yet — this task only prepares the model.
 */
export function invoiceKindOf(invoice: { kind?: string | null } | null | undefined): InvoiceKind {
  const stored = String(invoice?.kind ?? '');
  if (stored === InvoiceKind.STATEMENT) return InvoiceKind.STATEMENT;
  if (stored === InvoiceKind.EQUIPMENT) return InvoiceKind.EQUIPMENT;
  return InvoiceKind.SOW;
}
