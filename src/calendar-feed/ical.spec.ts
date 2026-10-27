import { escapeText, foldLine, icalUtc, toICalendar, ICalEvent } from './ical';

const ev = (over: Partial<ICalEvent> = {}): ICalEvent => ({
  uid: 'booking-abc@damplab-canvas',
  start: new Date('2026-01-06T15:00:00Z'),
  end: new Date('2026-01-06T17:00:00Z'),
  summary: 'Bioanalyzer',
  tentative: false,
  stamp: new Date('2026-01-01T12:00:00Z'),
  ...over
});
const unfold = (s: string): string => s.replace(/\r\n /g, '');
const eventLines = (out: string): string[] => {
  const lines = unfold(out).split('\r\n');
  return lines.slice(lines.indexOf('BEGIN:VEVENT') + 1, lines.indexOf('END:VEVENT'));
};

describe('toICalendar', () => {
  it('wraps the events in one VCALENDAR named DAMP Lab equipment, CRLF throughout', () => {
    const out = toICalendar([ev()]);
    expect(out.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(out.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
    expect(out.split('\r\n')).toEqual(
      expect.arrayContaining(['VERSION:2.0', 'PRODID:-//DAMP Lab//Canvas equipment bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:DAMP Lab equipment'])
    );
  });

  it('writes exactly the seven event properties, times in UTC', () => {
    expect(eventLines(toICalendar([ev()]))).toEqual([
      'UID:booking-abc@damplab-canvas',
      'DTSTAMP:20260101T120000Z',
      'DTSTART:20260106T150000Z',
      'DTEND:20260106T170000Z',
      'SUMMARY:Bioanalyzer',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE'
    ]);
  });

  it('marks a tentative event TENTATIVE', () => {
    expect(eventLines(toICalendar([ev({ tentative: true })]))).toContain('STATUS:TENTATIVE');
  });

  it('writes a valid empty calendar when there are no events', () => {
    const out = toICalendar([]);
    expect(out).not.toContain('BEGIN:VEVENT');
    expect(out).toContain('X-WR-CALNAME:DAMP Lab equipment\r\n');
  });

  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
    expect(unfold(toICalendar([ev({ summary: 'PCR; rack 2, left' })]))).toContain('SUMMARY:PCR\\; rack 2\\, left\r\n');
  });
});

describe('foldLine', () => {
  it('leaves a line of exactly 75 octets alone', () => {
    expect(foldLine('S'.repeat(75))).toBe('S'.repeat(75));
  });

  it('folds longer lines at 75 octets with a leading space, and unfolds back', () => {
    const long = 'SUMMARY:' + 'x'.repeat(200);
    const parts = foldLine(long).split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(unfold(foldLine(long))).toBe(long);
  });

  it('never splits a multi-byte character', () => {
    const long = 'SUMMARY:' + 'é'.repeat(100) + '🧪'.repeat(20);
    for (const p of foldLine(long).split('\r\n')) {
      expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(75);
      expect(p).not.toMatch(/�/);
      expect(Buffer.from(p, 'utf8').toString('utf8')).toBe(p);
    }
    expect(unfold(foldLine(long))).toBe(long);
  });
});

describe('icalUtc', () => {
  it('formats in UTC basic form without milliseconds', () => {
    expect(icalUtc(new Date('2026-03-08T06:30:45.123Z'))).toBe('20260308T063045Z');
  });
});
