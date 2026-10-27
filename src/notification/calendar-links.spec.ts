import { calendarLinks } from './calendar-links';

describe('calendarLinks', () => {
  const event = { title: 'Bioanalyzer, 2100', start: new Date('2026-01-06T15:00:00.000Z'), end: new Date('2026-01-06T17:00:00.000Z') };

  it('builds Google then Outlook new-event links with the item name and the slot in UTC', () => {
    expect(calendarLinks(event)).toEqual([
      { label: 'Add to Google Calendar', url: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Bioanalyzer%2C%202100&dates=20260106T150000Z/20260106T170000Z' },
      {
        label: 'Add to Outlook',
        url: 'https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=Bioanalyzer%2C%202100&startdt=2026-01-06T15:00:00Z&enddt=2026-01-06T17:00:00Z'
      }
    ]);
  });

  it('encodes characters that would break the query string', () => {
    const [google, outlook] = calendarLinks({ ...event, title: 'A&B #1 + C' });
    expect(google.url).toContain('text=A%26B%20%231%20%2B%20C&');
    expect(outlook.url).toContain('subject=A%26B%20%231%20%2B%20C&');
  });
});
