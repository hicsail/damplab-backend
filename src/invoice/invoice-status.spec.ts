import { InvoiceStatus, invoiceStatusFromDocument, invoiceVersionOf, paidStatus } from './invoice-kind';

describe('invoiceStatusFromDocument', () => {
  it('reads VOID first, even on an invoice that was also superseded', () => {
    expect(invoiceStatusFromDocument({ kind: 'STATEMENT', voidedAt: new Date(), supersededAt: new Date() })).toBe(InvoiceStatus.VOID);
  });

  it('reads SUPERSEDED once a newer version stands', () => {
    expect(invoiceStatusFromDocument({ kind: 'STATEMENT', supersededAt: new Date() })).toBe(InvoiceStatus.SUPERSEDED);
  });

  it('never lets a legacy SOW or EQUIPMENT invoice be paid off by the job’s payments', () => {
    // Several of these can stand at once, each covering part of the job.
    expect(invoiceStatusFromDocument({ kind: 'SOW' })).toBe(InvoiceStatus.ISSUED);
    expect(invoiceStatusFromDocument({ kind: 'EQUIPMENT' })).toBe(InvoiceStatus.ISSUED);
    expect(invoiceStatusFromDocument({})).toBe(InvoiceStatus.ISSUED);
  });

  it('leaves the current invoice to the payments', () => {
    expect(invoiceStatusFromDocument({ kind: 'STATEMENT' })).toBeNull();
  });
});

describe('paidStatus', () => {
  it('is PAID once payments cover the charges, and ISSUED a cent short', () => {
    expect(paidStatus(350, 350)).toBe(InvoiceStatus.PAID);
    expect(paidStatus(350, 400)).toBe(InvoiceStatus.PAID);
    expect(paidStatus(350, 349.99)).toBe(InvoiceStatus.ISSUED);
  });

  it('is PAID for an invoice discounted to nothing — how staff settle a remainder', () => {
    expect(paidStatus(0, 0)).toBe(InvoiceStatus.PAID);
  });

  it('compares in cents, so float noise cannot hold an invoice open', () => {
    expect(paidStatus(0.3, 0.1 + 0.2)).toBe(InvoiceStatus.PAID);
  });
});

describe('invoiceVersionOf', () => {
  it('prefers the stored version', () => {
    expect(invoiceVersionOf({ versionNumber: 3, invoiceNumber: '04217-009' })).toBe(3);
  });

  it('reads a pre-versioning invoice off its number’s suffix', () => {
    expect(invoiceVersionOf({ invoiceNumber: '04217-002' })).toBe(2);
  });

  it('is null when neither says', () => {
    expect(invoiceVersionOf({ invoiceNumber: 'INV' })).toBeNull();
    expect(invoiceVersionOf(null)).toBeNull();
  });
});
