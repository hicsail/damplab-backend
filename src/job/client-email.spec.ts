import { effectiveClientEmailExpr } from './client-email';

describe('effectiveClientEmailExpr', () => {
  it('trims clientEmail before deciding whether it is set, so whitespace falls back to email', () => {
    const cond = (effectiveClientEmailExpr() as any).$toLower.$trim.input.$cond;
    expect(cond[0]).toEqual({ $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ['$clientEmail', ''] } } } }, 0] });
  });
});
