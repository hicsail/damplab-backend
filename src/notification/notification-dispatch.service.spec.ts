import { NotificationDispatchService } from './notification-dispatch.service';
import { calendarLinks } from './calendar-links';
import { RecipientRole } from './notification.constants';

function service(job: any): NotificationDispatchService {
  return new NotificationDispatchService({} as any, {} as any, { findById: async () => job } as any, { getLabStaffGroupMembers: async () => [] } as any);
}

describe('JOB_OWNER recipients (B24, B28)', () => {
  it('reaches the client once (sub and clientEmail are the same person now), then every member, and not the staff submitter', async () => {
    const recipients = await (
      service({ sub: 'client-kc', email: 'client@bu.edu', clientEmail: 'Client@BU.edu', submittedBy: { sub: 'admin-1', email: 'tech@bu.edu' }, memberEmails: ['a@x.org', 'B@x.org'] }) as any
    ).resolveRecipients([RecipientRole.JOB_OWNER], 'job-1');
    expect(recipients).toEqual([
      { sub: 'client-kc', email: 'client@bu.edu' },
      { sub: 'email:a@x.org', email: 'a@x.org' },
      { sub: 'email:b@x.org', email: 'b@x.org' }
    ]);
  });

  it('reaches a client with no account yet by email', async () => {
    const recipients = await (service({ email: 'new@bu.edu', clientEmail: 'new@bu.edu', submittedBy: { sub: 'admin-1' } }) as any).resolveRecipients([RecipientRole.JOB_OWNER], 'job-1');
    expect(recipients).toEqual([{ sub: 'email:new@bu.edu', email: 'new@bu.edu' }]);
  });

  it('keeps a legacy, unmigrated staff submission reaching both the technician (old owner) and the client', async () => {
    const recipients = await (service({ sub: 'staff-sub', email: 'tech@bu.edu', clientEmail: 'client@bu.edu' }) as any).resolveRecipients([RecipientRole.JOB_OWNER], 'job-1');
    expect(recipients).toEqual([
      { sub: 'staff-sub', email: 'tech@bu.edu' },
      { sub: 'email:client@bu.edu', email: 'client@bu.edu' }
    ]);
  });

  it('adds nothing for a legacy job without members', async () => {
    const recipients = await (service({ sub: 's', email: 'o@x.org' }) as any).resolveRecipients([RecipientRole.JOB_OWNER], 'job-1');
    expect(recipients).toEqual([{ sub: 's', email: 'o@x.org' }]);
  });
});

describe('add-to-calendar links (booking-calendar 13, 14)', () => {
  const build = (): { svc: NotificationDispatchService; send: jest.Mock; create: jest.Mock } => {
    const send = jest.fn();
    const create = jest.fn(async (doc: any) => ({ _id: 'n1', ...doc }));
    const notificationService: any = { getPreferences: async () => ({ inAppDisabledEventTypes: [], emailDisabledEventTypes: [] }), create, markEmailSent: async () => undefined };
    const svc = new NotificationDispatchService(
      notificationService,
      { send } as any,
      { findById: async () => ({ sub: 'client-kc', email: 'client@bu.edu' }) } as any,
      { getLabStaffGroupMembers: async () => [] } as any
    );
    return { svc, send, create };
  };
  const calendarEvent = { title: 'Bioanalyzer', start: new Date('2026-01-06T15:00:00Z'), end: new Date('2026-01-06T17:00:00Z') };

  it('puts both links on the email when the dispatch carries a calendar event, and leaves the in-app notification alone', async () => {
    const { svc, send, create } = build();
    await (svc as any).doDispatch({ eventType: 'EQUIPMENT_BOOKING_APPROVED', title: 'Equipment booking approved', message: 'm', jobId: 'job-1', calendarEvent });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].calendarLinks).toEqual(calendarLinks(calendarEvent));
    expect(create.mock.calls[0][0]).not.toHaveProperty('calendarLinks');
    expect(create.mock.calls[0][0]).not.toHaveProperty('calendarEvent');
  });

  it('sends no links without one', async () => {
    const { svc, send } = build();
    await (svc as any).doDispatch({ eventType: 'EQUIPMENT_BOOKING_DECLINED', title: 't', message: 'm', jobId: 'job-1' });
    expect(send.mock.calls[0][0]).not.toHaveProperty('calendarLinks');
  });
});
