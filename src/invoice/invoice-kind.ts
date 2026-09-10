import { registerEnumType } from '@nestjs/graphql';

export enum InvoiceKind {
  /** Bills service lines from the job's Statement of Work. */
  SOW = 'SOW',
  /** A running statement of the job's confirmed equipment usage, payments and balance. */
  EQUIPMENT = 'EQUIPMENT',
  /** The job's invoice: everything it has been charged, less what it has paid. Every new invoice is one, and each new one supersedes the last. */
  STATEMENT = 'STATEMENT'
}
registerEnumType(InvoiceKind, { name: 'InvoiceKind', description: 'What an invoice bills.' });

export enum InvoiceStatus {
  /** The job's current invoice, not yet covered by the payments recorded on the job. */
  ISSUED = 'ISSUED',
  /** The job's current invoice, and the payments recorded on the job cover its charges. */
  PAID = 'PAID',
  /** A newer version has been issued. Kept as history; not payable. */
  SUPERSEDED = 'SUPERSEDED',
  /** Withdrawn, with a reason. Not payable. */
  VOID = 'VOID'
}
registerEnumType(InvoiceStatus, { name: 'InvoiceStatus', description: 'Where an invoice stands.' });

/**
 * An invoice's kind, with the legacy fallback in one place.
 *
 * Every invoice written before this field existed bills SOW service lines, so
 * an absent `kind` reads as SOW. This is a READ-TIME fallback rather than a
 * schema default deliberately: a default only reaches documents Mongoose
 * hydrates, and the resolver and the UI must all agree about a `.lean()` row
 * and a projected one too.
 *
 * Anything unrecognised also reads as SOW — the safe direction. `createForJob`
 * writes only STATEMENT now; SOW and EQUIPMENT persist as the kind of every
 * document the two retired generators already wrote.
 */
export function invoiceKindOf(invoice: { kind?: string | null } | null | undefined): InvoiceKind {
  const stored = String(invoice?.kind ?? '');
  if (stored === InvoiceKind.STATEMENT) return InvoiceKind.STATEMENT;
  if (stored === InvoiceKind.EQUIPMENT) return InvoiceKind.EQUIPMENT;
  return InvoiceKind.SOW;
}

/**
 * An invoice's status where the document alone decides it, or null when it
 * depends on the job's payments.
 *
 * Void and superseded come first so the resolver reads payments for the
 * current invoice only, never once per history row. A legacy SOW or EQUIPMENT
 * document is never PAID: several of those can stand at once, each covering
 * part of the job, so comparing each against the job's payments would mark
 * them all paid.
 */
export function invoiceStatusFromDocument(invoice: { voidedAt?: unknown; supersededAt?: unknown; kind?: string | null } | null | undefined): InvoiceStatus | null {
  if (invoice?.voidedAt) return InvoiceStatus.VOID;
  if (invoice?.supersededAt) return InvoiceStatus.SUPERSEDED;
  if (invoiceKindOf(invoice) !== InvoiceKind.STATEMENT) return InvoiceStatus.ISSUED;
  return null;
}

/** PAID once the job's payments cover what the invoice charged; compared in cents. */
export function paidStatus(charges: number, paymentsToDate: number): InvoiceStatus {
  const cents = (n: number): number => Math.round((Number(n) || 0) * 100);
  return cents(paymentsToDate) >= cents(charges) ? InvoiceStatus.PAID : InvoiceStatus.ISSUED;
}

/**
 * Which version of the job's invoice this is.
 *
 * The stored number where there is one; otherwise the invoice number's
 * `-NNN` suffix, which was always the per-job count — so every document
 * written before versioning still reads as the version it effectively was.
 */
export function invoiceVersionOf(invoice: { versionNumber?: number | null; invoiceNumber?: string | null } | null | undefined): number | null {
  if (invoice?.versionNumber != null) return Number(invoice.versionNumber);
  const match = /-(\d+)$/.exec(String(invoice?.invoiceNumber ?? ''));
  return match ? Number(match[1]) : null;
}
