import { ForbiddenException } from '@nestjs/common';
import { SOWResolver } from './sow.resolver';
import { Role } from '../auth/roles/roles.enum';
import { User } from '../auth/user.interface';

/**
 * Exercises the resolver method bodies, not just the access predicate: the
 * predicate is only correct if sowById/sowByJobId actually look up the right job
 * and hand it over. A regression here would silently hide every customer's SOW.
 */
function user(overrides: Partial<User> = {}): User {
  return { preferred_username: 'u', sub: 'sub-x', email: 'x@example.com', realm_access: { roles: [] }, ...overrides } as User;
}

const staff = user({ sub: 'sub-staff', email: 'tech@bu.edu', realm_access: { roles: [Role.DamplabStaff] } });
const owner = user({ sub: 'sub-owner', email: 'client@lab.org' });
const stranger = user({ sub: 'sub-other', email: 'other@example.com' });

const SOW_ID = 'sow-1';
const JOB_ID = 'job-1';
const sow = { id: SOW_ID, jobId: JOB_ID, clientEmail: 'client@lab.org' } as any;
const job = { sub: 'sub-owner', email: 'client@lab.org' } as any;

function build(overrides: { sow?: any; job?: any } = {}): { resolver: SOWResolver; sowService: any; jobService: any; sowVersionService: any } {
  const sowService = {
    findById: jest.fn().mockResolvedValue('sow' in overrides ? overrides.sow : sow),
    findByJobId: jest.fn().mockResolvedValue('sow' in overrides ? overrides.sow : sow)
  } as any;
  const jobService = {
    findById: jest.fn().mockResolvedValue('job' in overrides ? overrides.job : job)
  } as any;
  const sowVersionService = {
    actionGate: jest.fn().mockResolvedValue({ canSend: true, sendBlockers: [], canSign: true, signBlockers: [], canCountersign: false, countersignBlockers: [], missingFields: [] })
  } as any;
  return { resolver: new SOWResolver(sowService, jobService, sowVersionService), sowService, jobService, sowVersionService };
}

describe('SOWResolver.sowByJobId', () => {
  it('returns the SOW for staff', async () => {
    const { resolver } = build();
    await expect(resolver.sowByJobId(JOB_ID, staff)).resolves.toBe(sow);
  });

  it('returns the SOW for the job owner', async () => {
    const { resolver } = build();
    await expect(resolver.sowByJobId(JOB_ID, owner)).resolves.toBe(sow);
  });

  it('rejects an unrelated authenticated user', async () => {
    const { resolver } = build();
    await expect(resolver.sowByJobId(JOB_ID, stranger)).rejects.toThrow(ForbiddenException);
  });

  it('looks up the job by the id it was asked about', async () => {
    const { resolver, jobService } = build();
    await resolver.sowByJobId(JOB_ID, staff);
    expect(jobService.findById).toHaveBeenCalledWith(JOB_ID);
  });

  it('returns null without an access error when no SOW exists', async () => {
    const { resolver } = build({ sow: null });
    await expect(resolver.sowByJobId(JOB_ID, stranger)).resolves.toBeNull();
  });
});

describe('SOWResolver.sowById', () => {
  it('returns the SOW for staff', async () => {
    const { resolver } = build();
    await expect(resolver.sowById(SOW_ID, staff)).resolves.toBe(sow);
  });

  it('returns the SOW for the job owner', async () => {
    const { resolver } = build();
    await expect(resolver.sowById(SOW_ID, owner)).resolves.toBe(sow);
  });

  it('rejects an unrelated authenticated user', async () => {
    const { resolver } = build();
    await expect(resolver.sowById(SOW_ID, stranger)).rejects.toThrow(ForbiddenException);
  });

  it("resolves the job via the SOW's jobId, not the SOW id", async () => {
    const { resolver, jobService } = build();
    await resolver.sowById(SOW_ID, staff);
    expect(jobService.findById).toHaveBeenCalledWith(JOB_ID);
  });

  it('does not leak a SOW whose job has gone missing', async () => {
    const { resolver } = build({ job: null });
    await expect(resolver.sowById(SOW_ID, owner)).rejects.toThrow(ForbiddenException);
  });
});

describe('SOWResolver.actionGate', () => {
  it('forwards the optional expected sign version to the shared gate', async () => {
    const { resolver, sowVersionService } = build();

    await (resolver as any).actionGate({ _id: SOW_ID }, staff, 1000);

    expect(sowVersionService.actionGate).toHaveBeenCalledWith(SOW_ID, 1000, { reconcile: true });
  });

  it('gives staff the whole gate', async () => {
    const { resolver } = build();

    await expect((resolver as any).actionGate({ _id: SOW_ID }, staff)).resolves.toMatchObject({
      canSend: true,
      canSign: true,
      missingFields: []
    });
  });

  // sendBlockers and missingFields are the lab's internal repair checklist —
  // they name staff chores and the document sections still unwritten. Signing is
  // the only action a customer can take, so it is the only half they get.
  it('gives a customer the signing half only, and never reconciles on their read', async () => {
    const { resolver, sowVersionService } = build();
    sowVersionService.actionGate.mockResolvedValue({
      canSend: true,
      sendBlockers: ['DRAFT_INCOMPLETE'],
      canSign: false,
      signBlockers: ['UNSENT_DRAFT'],
      canCountersign: true,
      countersignBlockers: ['DOCUMENT_STALE'],
      missingFields: ['Engagement Resources']
    });

    const gate = await (resolver as any).actionGate({ _id: SOW_ID }, owner);

    expect(gate).toEqual({
      canSend: false,
      sendBlockers: [],
      canSign: false,
      signBlockers: ['UNSENT_DRAFT'],
      canCountersign: false,
      countersignBlockers: [],
      missingFields: []
    });
    expect(sowVersionService.actionGate).toHaveBeenCalledWith(SOW_ID, undefined, { reconcile: false });
  });
});
