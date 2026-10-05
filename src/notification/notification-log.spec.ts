import { NotificationEmailService } from './notification-email.service';
import { NotificationService } from './notification.service';
import { NotificationDispatchService } from './notification-dispatch.service';
import { formatEmailForLog, notificationLogOnly } from './notification-log';

const config = (values: Record<string, unknown>): any => ({ get: (key: string) => values[key] });

describe('log-only notifications (local testing)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is off unless set to exactly "true"', () => {
    expect(notificationLogOnly(config({}))).toBe(false);
    expect(notificationLogOnly(config({ 'notifications.logOnly': 'false' }))).toBe(false);
    expect(notificationLogOnly(undefined)).toBe(false);
    expect(notificationLogOnly(config({ 'notifications.logOnly': 'true' }))).toBe(true);
  });

  it('logs the whole email and never calls Mailgun — even with email enabled and a key set', () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const svc = new NotificationEmailService(
      config({ 'notifications.logOnly': 'true', 'notifications.emailEnabled': 'true', 'notifications.mailgunApiKey': 'key', 'notifications.appBaseUrl': 'http://localhost:5173' }) as any
    );
    const log = jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
    svc.send({ to: 'pm@bu.edu', subject: '[DampLab] Booking awaiting approval', title: 't', message: 'Cara booked the Bioanalyzer.', link: '/technician_view/job-1' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toBe(
      formatEmailForLog({ to: 'pm@bu.edu', subject: '[DampLab] Booking awaiting approval', message: 'Cara booked the Bioanalyzer.', linkUrl: 'http://localhost:5173/technician_view/job-1' })
    );
  });

  it('logs each in-app notification as it is stored, and stays quiet when off', async () => {
    const model: any = { create: jest.fn(async (doc: any) => doc) };
    const on = new NotificationService(model, {} as any, config({ 'notifications.logOnly': 'true' }) as any);
    const off = new NotificationService(model, {} as any, config({}) as any);
    const logOn = jest.spyOn((on as any).logger, 'log').mockImplementation(() => undefined);
    const logOff = jest.spyOn((off as any).logger, 'log').mockImplementation(() => undefined);
    const input = { recipientSub: 'pm-sub', recipientEmail: 'pm@bu.edu', eventType: 'EQUIPMENT_BOOKING_REQUESTED', title: 'Booking awaiting approval', message: 'm', link: '/technician_view/job-1' };
    await on.create(input);
    await off.create(input);
    expect(logOn.mock.calls[0][0]).toBe('[notifications] in-app EQUIPMENT_BOOKING_REQUESTED to=pm@bu.edu — "Booking awaiting approval" → /technician_view/job-1');
    expect(logOff).not.toHaveBeenCalled();
    expect(model.create).toHaveBeenCalledTimes(2);
  });

  it('traces who a dispatch reached and why anyone was skipped', async () => {
    const prefs = { inAppDisabledEventTypes: [], emailDisabledEventTypes: ['EQUIPMENT_BOOKING_REQUESTED'] };
    const notificationService: any = { getPreferences: async () => prefs, create: async () => ({ _id: 'n1' }), markEmailSent: async () => undefined };
    const emailService: any = { send: jest.fn() };
    const keycloak: any = { getUserById: async (sub: string) => (sub === 'pm-sub' ? { email: 'pm@bu.edu' } : null), getLabStaffGroupMembers: async () => [] };
    const svc = new NotificationDispatchService(notificationService, emailService, {} as any, keycloak, config({ 'notifications.logOnly': 'true' }) as any);
    const log = jest.spyOn((svc as any).logger, 'log').mockImplementation(() => undefined);
    await (svc as any).doDispatch({ eventType: 'EQUIPMENT_BOOKING_REQUESTED', title: 't', message: 'm', jobId: 'job-1', actorDisplayName: 'cara', staffSubs: ['pm-sub', 'lead-sub'] });
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines).toContain('[notifications] EQUIPMENT_BOOKING_REQUESTED (job job-1) by cara: NAMED_STAFF [named: pm-sub, lead-sub] → pm@bu.edu, lead-sub');
    expect(lines).toContain('[notifications] EQUIPMENT_BOOKING_REQUESTED: email skipped for pm@bu.edu — turned off in their preferences');
    expect(lines).toContain('[notifications] EQUIPMENT_BOOKING_REQUESTED: no email for lead-sub — no address known');
    expect(emailService.send).not.toHaveBeenCalled();
  });
});
