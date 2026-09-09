import { normalizeBookerEmails } from './booker-emails';

describe('normalizeBookerEmails', () => {
  it('trims, lowercases, dedupes and drops blanks', () => {
    expect(normalizeBookerEmails([' A@B.com ', 'a@b.com', '', '  ', 'c@d.org'])).toEqual(['a@b.com', 'c@d.org']);
  });

  it('accepts a bare string and shrugs off anything else', () => {
    expect(normalizeBookerEmails('A@B.com')).toEqual(['a@b.com']);
    expect(normalizeBookerEmails(undefined)).toEqual([]);
    expect(normalizeBookerEmails(null)).toEqual([]);
    expect(normalizeBookerEmails(7)).toEqual([]);
  });
});
