export interface CalendarEventInput {
  title: string;
  start: Date;
  end: Date;
}

export interface CalendarLink {
  label: string;
  url: string;
}

const enc = encodeURIComponent;

/** `2026-01-06T15:00:00.000Z` -> `2026-01-06T15:00:00Z` */
const outlookTime = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
/** `2026-01-06T15:00:00.000Z` -> `20260106T150000Z` */
const googleTime = (d: Date): string => outlookTime(d).replace(/[-:]/g, '');

/** Add-to-calendar links for one event: [Google, Outlook], times in UTC. */
export function calendarLinks(event: CalendarEventInput): CalendarLink[] {
  return [
    {
      label: 'Add to Google Calendar',
      url: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(event.title)}&dates=${googleTime(event.start)}/${googleTime(event.end)}`
    },
    {
      label: 'Add to Outlook',
      url: `https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${enc(event.title)}&startdt=${outlookTime(event.start)}&enddt=${outlookTime(
        event.end
      )}`
    }
  ];
}
