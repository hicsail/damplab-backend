export interface ICalEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  tentative: boolean;
  stamp: Date;
}

export const CALENDAR_NAME = 'DAMP Lab equipment';

/** Basic-form UTC timestamp without milliseconds, e.g. 20260106T150000Z. */
export function icalUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/** Escape a TEXT value per RFC 5545 section 3.3.11. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold a content line at 75 octets, counting UTF-8 bytes and never splitting a code point. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let octets = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (octets + n > 75) {
      out.push(current);
      current = ' ';
      octets = 1;
    }
    current += ch;
    octets += n;
  }
  out.push(current);
  return out.join('\r\n');
}

export function toICalendar(events: ICalEvent[]): string {
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DAMP Lab//Canvas equipment bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${CALENDAR_NAME}`];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${icalUtc(e.stamp)}`,
      `DTSTART:${icalUtc(e.start)}`,
      `DTEND:${icalUtc(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `STATUS:${e.tentative ? 'TENTATIVE' : 'CONFIRMED'}`,
      'TRANSP:OPAQUE',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map((l) => foldLine(l) + '\r\n').join('');
}
