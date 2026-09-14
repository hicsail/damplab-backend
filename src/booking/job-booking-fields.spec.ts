import { BookingSchema } from './booking.model';
import { JobSchema } from '../job/job.model';

describe('job-scoped booking storage', () => {
  it('carries the job link on a Booking as plain strings', () => {
    for (const path of ['jobId', 'nodeId', 'serviceId']) {
      expect(BookingSchema.path(path)).toBeDefined();
      expect(BookingSchema.path(path).instance).toBe('String');
    }
  });

  it('indexes bookings by job, for run 3 and for the job page', () => {
    const indexed = BookingSchema.indexes().map(([fields]) => JSON.stringify(fields));
    expect(indexed).toContain(JSON.stringify({ jobId: 1 }));
  });

  it('carries the booking pause on a Job', () => {
    expect(JobSchema.path('bookingBlocked').instance).toBe('Boolean');
    expect(JobSchema.path('bookingBlockedReason').instance).toBe('String');
    expect(JobSchema.path('bookingBlockedBy').instance).toBe('String');
    expect(JobSchema.path('bookingBlockedAt').instance).toBe('Date');
  });
});
