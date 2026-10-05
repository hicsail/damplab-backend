import { HomologyScreeningStatus } from './job.model';
import { JobService } from './job.service';

describe('setAclidScreening', () => {
  it('persists aclidScreening on the job document', async () => {
    const jobId = '000000000000000000000001';
    const aclidScreening = {
      screenId: 'screen-1',
      homologyStatus: HomologyScreeningStatus.IN_PROGRESS,
      regulatoryStatus: null,
      verificationStatus: null,
      decisionStatus: null,
      verificationCompletedAt: null,
      sequenceCount: 2,
      startedAt: new Date('2026-09-14T12:00:00.000Z'),
      completedAt: null,
      detail: null,
      customerStatus: HomologyScreeningStatus.IN_PROGRESS
    };
    const updatedJob = { _id: jobId, aclidScreening };
    const findOneAndUpdate = jest.fn(() => ({
      exec: jest.fn(async () => updatedJob)
    }));
    const jobModel: any = { findOneAndUpdate };
    const service = new JobService(jobModel, {} as any, {} as any, {} as any);

    const result = await service.setAclidScreening(jobId, aclidScreening);

    expect(findOneAndUpdate).toHaveBeenCalledWith({ _id: jobId }, { $set: { aclidScreening } }, { new: true });
    expect(result).toBe(updatedJob);
  });

  /**
   * The rerun case: staff press "Run screening" on a job whose customer has
   * already verified, and Aclid is briefly unreachable. The failing run has no
   * screen id to offer, and it must not take the one we have with it.
   */
  it('keeps the screen id and the KYC decision when a failed run has no screen of its own', async () => {
    const jobId = '000000000000000000000002';
    const verifiedAt = new Date('2026-09-14T10:00:00.000Z');
    const existing = {
      screenId: 'screen-1',
      homologyStatus: HomologyScreeningStatus.PASSED,
      regulatoryStatus: 'not_controlled',
      verificationStatus: 'completed',
      decisionStatus: 'approved',
      verificationCompletedAt: verifiedAt,
      sequenceCount: 2,
      startedAt: new Date('2026-09-14T09:00:00.000Z'),
      completedAt: new Date('2026-09-14T09:01:00.000Z'),
      detail: null,
      customerStatus: HomologyScreeningStatus.PASSED
    };
    const findOneAndUpdate: jest.Mock = jest.fn(() => ({ exec: jest.fn(async () => ({ _id: jobId })) }));
    const jobModel: any = { findOneAndUpdate, findById: jest.fn(async () => ({ _id: jobId, aclidScreening: existing })) };
    const service = new JobService(jobModel, {} as any, {} as any, {} as any);

    await service.setAclidScreening(jobId, {
      screenId: null,
      homologyStatus: HomologyScreeningStatus.UNAVAILABLE,
      sequenceCount: 2,
      startedAt: new Date('2026-09-14T11:00:00.000Z'),
      completedAt: new Date('2026-09-14T11:00:05.000Z'),
      detail: 'Aclid unavailable: fetch failed',
      customerStatus: HomologyScreeningStatus.UNAVAILABLE
    } as any);

    const written = findOneAndUpdate.mock.calls[0][1].$set.aclidScreening;
    expect(written.screenId).toBe('screen-1');
    expect(written.decisionStatus).toBe('approved');
    expect(written.verificationStatus).toBe('completed');
    expect(written.verificationCompletedAt).toBe(verifiedAt);
    expect(written.customerStatus).toBe(HomologyScreeningStatus.PASSED);
    // This run genuinely got no homology answer, and says so.
    expect(written.homologyStatus).toBe(HomologyScreeningStatus.UNAVAILABLE);
    expect(written.detail).toBe('Aclid unavailable: fetch failed');
  });

  it('replaces the record outright when the new run has a screen of its own', async () => {
    const jobId = '000000000000000000000003';
    const findOneAndUpdate: jest.Mock = jest.fn(() => ({ exec: jest.fn(async () => ({ _id: jobId })) }));
    const findById = jest.fn();
    const jobModel: any = { findOneAndUpdate, findById };
    const service = new JobService(jobModel, {} as any, {} as any, {} as any);

    await service.setAclidScreening(jobId, {
      screenId: 'screen-2',
      homologyStatus: HomologyScreeningStatus.PASSED,
      sequenceCount: 1,
      startedAt: new Date('2026-09-14T12:00:00.000Z'),
      customerStatus: HomologyScreeningStatus.IN_PROGRESS
    } as any);

    // A new screen orphans the old verification by definition, so there is
    // nothing to read back and nothing to keep.
    expect(findById).not.toHaveBeenCalled();
    expect(findOneAndUpdate.mock.calls[0][1].$set.aclidScreening.screenId).toBe('screen-2');
  });
});

describe('JobService.claimSubIfPrimary (B29)', () => {
  const build = (): { service: JobService; updates: any[] } => {
    const updates: any[] = [];
    const jobModel: any = {
      findOneAndUpdate: (filter: any, update: any): { exec: () => Promise<any> } => ({
        exec: async (): Promise<any> => {
          updates.push({ filter, update });
          return { _id: filter._id, sub: update.$set.sub, email: 'client@bu.edu' };
        }
      })
    };
    return { service: new JobService(jobModel, {} as any, {} as any, {} as any), updates };
  };
  const unclaimed: any = { _id: 'job-1', email: 'client@bu.edu', clientEmail: 'client@bu.edu' };

  it("stores the primary client's sub on a job that has none, conditionally", async () => {
    const { service, updates } = build();
    const out = await service.claimSubIfPrimary(unclaimed, { sub: 'client-kc', email: 'Client@BU.edu' });
    expect(out.sub).toBe('client-kc');
    expect(updates[0].filter).toEqual({ _id: 'job-1', $or: [{ sub: { $exists: false } }, { sub: null }, { sub: '' }] });
  });

  it('records their username too when the job has none, and leaves a stored one alone', async () => {
    const { service, updates } = build();
    await service.claimSubIfPrimary(unclaimed, { sub: 'client-kc', email: 'client@bu.edu', preferred_username: 'cara' });
    await service.claimSubIfPrimary({ ...unclaimed, username: 'kept' }, { sub: 'client-kc', email: 'client@bu.edu', preferred_username: 'cara' });
    expect(updates.map((u) => u.update.$set)).toEqual([{ sub: 'client-kc', username: 'cara' }, { sub: 'client-kc' }]);
  });

  it('never overwrites a set sub, and ignores members and strangers', async () => {
    const { service, updates } = build();
    await service.claimSubIfPrimary({ ...unclaimed, sub: 'someone' }, { sub: 'client-kc', email: 'client@bu.edu' });
    await service.claimSubIfPrimary({ ...unclaimed, memberEmails: ['m@x.org'] }, { sub: 'm', email: 'm@x.org' });
    await service.claimSubIfPrimary(unclaimed, { sub: 'x', email: 'x@x.org' });
    await service.claimSubIfPrimary(unclaimed, { email: 'client@bu.edu' });
    expect(updates).toEqual([]);
  });
});
