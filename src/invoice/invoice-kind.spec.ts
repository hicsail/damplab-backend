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
});
