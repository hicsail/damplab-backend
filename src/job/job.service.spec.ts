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
});
