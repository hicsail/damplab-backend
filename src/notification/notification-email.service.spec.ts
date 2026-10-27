import { NotificationEmailService } from './notification-email.service';

const config = (values: Record<string, unknown>): any => ({ get: (key: string) => values[key] });
const svc = new NotificationEmailService(config({ 'notifications.appBaseUrl': 'https://canvas.test' }));
const base = { to: 'c@bu.edu', subject: '[DampLab] Equipment booking approved', title: 'Equipment booking approved', message: 'Your booking of Bioanalyzer is approved.', link: '/client_view/job-1' };
const links = [
  { label: 'Add to Google Calendar', url: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Bioanalyzer' },
  { label: 'Add to Outlook', url: 'https://outlook.office.com/calendar/0/deeplink/compose?rru=addevent&subject=Bioanalyzer' }
];

describe('NotificationEmailService.buildHtml calendar links', () => {
  it('renders both links under the message and above the app button', () => {
    const html: string = (svc as any).buildHtml({ ...base, calendarLinks: links });
    expect(html).toContain('href="https://calendar.google.com/calendar/render?action=TEMPLATE&amp;text=Bioanalyzer"');
    expect(html).toContain('href="https://outlook.office.com/calendar/0/deeplink/compose?rru=addevent&amp;subject=Bioanalyzer"');
    expect(html).toMatch(/>Add to Google Calendar<\/a>/);
    expect(html).toMatch(/>Add to Outlook<\/a>/);
    expect(html.indexOf('Add to Google Calendar')).toBeGreaterThan(html.indexOf('Your booking of Bioanalyzer'));
    expect(html.indexOf('Add to Outlook')).toBeLessThan(html.indexOf('View in DampLab'));
  });

  it('renders no calendar block without links', () => {
    expect((svc as any).buildHtml(base)).not.toContain('Add to');
    expect((svc as any).buildHtml({ ...base, calendarLinks: [] })).not.toContain('Add to');
  });
});
