import { JobService } from './job.service';

/** Only `setBookingBlock` is exercised, so every other collaborator stays undefined. */
const build = (): { service: JobService; calls: any[] } => {
  const calls: any[] = [];
  const model: any = {
    findByIdAndUpdate: (id: string, update: any) => {
      calls.push({ id, update });
      return { exec: async () => ({ _id: id }) };
    }
  };
  // JobService(jobModel, jobFeedStatusModel, workflowService, sowService) — four
  // parameters; only the first is used by setBookingBlock.
  const service = new JobService(model, undefined as any, undefined as any, undefined as any);
  return { service, calls };
};

describe('JobService.setBookingBlock', () => {
  it('records the reason, who and when when pausing', async () => {
    const { service, calls } = build();
    await service.setBookingBlock('job-1', true, '  unpaid invoice  ', 'tech@bu.edu');
    expect(calls[0].update.$set).toMatchObject({ bookingBlocked: true, bookingBlockedReason: 'unpaid invoice', bookingBlockedBy: 'tech@bu.edu' });
    expect(calls[0].update.$set.bookingBlockedAt).toBeInstanceOf(Date);
  });

  it('refuses to pause without a reason', async () => {
    const { service } = build();
    await expect(service.setBookingBlock('job-1', true, '   ', 'tech@bu.edu')).rejects.toThrow('A reason is required to pause booking on a job.');
  });

  it('clears the reason when unpausing, and still records who and when', async () => {
    const { service, calls } = build();
    await service.setBookingBlock('job-1', false, undefined, 'tech@bu.edu');
    expect(calls[0].update.$set).toMatchObject({ bookingBlocked: false, bookingBlockedBy: 'tech@bu.edu' });
    expect(calls[0].update.$unset).toEqual({ bookingBlockedReason: 1 });
  });
});
