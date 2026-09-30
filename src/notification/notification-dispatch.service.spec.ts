import { NotificationDispatchService } from './notification-dispatch.service';
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
