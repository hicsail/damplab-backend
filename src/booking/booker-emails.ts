/**
 * Backend twin of `normalizeBookerEmails` in
 * damplab-ui/src/utils/equipmentParams.ts. The authorised-booker list is typed by
 * hand into the canvas, so `Booker@BU.edu` and `booker@bu.edu` are one person —
 * and eligibility is decided on the server, which therefore needs its own copy of
 * the normalisation the browser applied. Keep the two identical.
 */
const asList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((v) => (v == null ? '' : String(v)));
  if (typeof value === 'string') return [value];
  return [];
};

/** Trimmed, lowercased, deduplicated, blanks dropped. */
export function normalizeBookerEmails(value: unknown): string[] {
  const seen = new Set<string>();
  for (const raw of asList(value)) {
    const email = raw.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}
