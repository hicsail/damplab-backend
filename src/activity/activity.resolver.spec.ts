import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ActivityResolver } from './activity.resolver';
import { Role } from '../auth/roles/roles.enum';

const job = { _id: 'job-1', sub: 'owner-sub', email: 'owner@x.org', memberEmails: ['member@x.org'] };
const user = (sub: string, email: string, roles: string[] = []): any => ({ sub, email, preferred_username: sub, realm_access: { roles } });

function harness(): { resolver: ActivityResolver; activity: any } {
  const activity: any = { listEventsForJob: jest.fn(async () => [{ message: 'e' }]) };
  const jobService: any = { findById: jest.fn(async (id: string) => (id === 'job-1' ? job : null)) };
  return { resolver: new ActivityResolver(activity, jobService), activity };
}

describe('ActivityResolver.jobActivityTimeline — scoped to the job', () => {
  it('lets a member and a jobs:view-all holder read it', async () => {
    const { resolver } = harness();
    await expect(resolver.jobActivityTimeline('job-1', null, null, null, user('m', 'member@x.org'))).resolves.toHaveLength(1);
    await expect(resolver.jobActivityTimeline('job-1', null, null, null, user('t', 't@bu.edu', [Role.Technician]))).resolves.toHaveLength(1);
  });

  it('refuses a stranger and 404s on a missing job', async () => {
    const { resolver, activity } = harness();
    await expect(resolver.jobActivityTimeline('job-1', null, null, null, user('x', 'x@x.org'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(resolver.jobActivityTimeline('nope', null, null, null, user('m', 'member@x.org'))).rejects.toBeInstanceOf(NotFoundException);
    expect(activity.listEventsForJob).not.toHaveBeenCalled();
  });
});
