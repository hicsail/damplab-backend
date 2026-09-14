import { InvoiceKind, invoiceKindOf } from './invoice-kind';

describe('invoiceKindOf', () => {
  it('reads an equipment invoice as EQUIPMENT', () => {
    expect(invoiceKindOf({ kind: 'EQUIPMENT' })).toBe(InvoiceKind.EQUIPMENT);
  });

  it.each([
    ['an explicit SOW invoice', { kind: 'SOW' }],
    ['a legacy invoice with no kind at all', {}],
    ['a legacy invoice with a null kind', { kind: null }],
    ['an unrecognised value, which must not read as equipment', { kind: 'USAGE' }],
    ['nothing at all', null]
  ])('reads %s as SOW', (_label, invoice) => {
    expect(invoiceKindOf(invoice as any)).toBe(InvoiceKind.SOW);
  });

  it('reads a statement as STATEMENT', () => {
    expect(invoiceKindOf({ kind: 'STATEMENT' })).toBe(InvoiceKind.STATEMENT);
  });

  it('still reads an absent or unrecognised kind as SOW, which is the safe direction', () => {
    expect(invoiceKindOf({})).toBe(InvoiceKind.SOW);
    expect(invoiceKindOf({ kind: 'statement' })).toBe(InvoiceKind.SOW);
    expect(invoiceKindOf(null)).toBe(InvoiceKind.SOW);
  });
});
