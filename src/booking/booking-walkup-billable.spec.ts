import { BookingService } from './booking.service';

/**
 * The walk-up Usage billing page bills a PERSON for their own bookings. A
 * job-scoped booking is billed to the JOB, through an equipment invoice on the
 * job page — offering it here would let the same hours be billed twice, to two
 * different parties.
 */
describe('billable usage excludes job-scoped bookings', () => {
  const capture = (): { filters: any[]; service: BookingService } => {
    const filters: any[] = [];
    const model: any = {
      find: (filter: any) => {
        filters.push(filter);
        return { sort: () => ({ exec: async (): Promise<any[]> => [] }) };
      },
      aggregate: async (pipeline: any[]): Promise<any[]> => {
        filters.push(pipeline[0].$match);
        return [];
      }
    };
    return { filters, service: new BookingService(model, {} as any, {} as any, {} as any) };
  };

  it('filters findBillableForOwner on jobId: null', async () => {
    const { filters, service } = capture();
    await service.findBillableForOwner('owner-sub');
    expect(filters[0]).toMatchObject({ ownerSub: 'owner-sub', jobId: null });
  });

  it('filters getBillableOwners on jobId: null too, so no owner row promises rows the detail list cannot show', async () => {
    const { filters, service } = capture();
    await service.getBillableOwners();
    expect(filters[0]).toMatchObject({ jobId: null });
  });
});
