import { ForbiddenException } from '@nestjs/common';
import { BookingResolver } from './booking.resolver';
import { Role } from '../auth/roles/roles.enum';

/**
 * `cancelBooking`'s branch on `booking.jobId` (Task 6): a job-scoped booking goes
 * through `JobEquipmentBookingService.assertMayCancel` instead of the walk-up
 * owner check, and a walk-up booking must never see that gate at all.
 */
describe('BookingResolver.cancelBooking', () => {
  const staff: any = { sub: 'staff-1', email: 'staff@bu.edu', realm_access: { roles: [Role.DamplabStaff] } };
  const stranger: any = { sub: 'stranger-1', email: 'stranger@bu.edu', realm_access: { roles: [] } };

  const harness = (booking: any): { resolver: BookingResolver; cancel: jest.Mock; assertMayCancel: jest.Mock } => {
    const cancel = jest.fn(async () => ({ ...booking, cancelled: true }));
    const bookingService: any = { findById: jest.fn(async () => booking), cancel };
    const assertMayCancel = jest.fn(async () => undefined);
    const jobEquipmentBookingService: any = { assertMayCancel };
    const resolver = new BookingResolver(bookingService, jobEquipmentBookingService);
    return { resolver, cancel, assertMayCancel };
  };

  describe('a job-scoped booking (jobId set)', () => {
    const booking = { _id: 'bk-1', jobId: 'job-1', nodeId: 'node-a', ownerSub: 'creator-sub' };

    it('routes through assertMayCancel before cancelling', async () => {
      const { resolver, cancel, assertMayCancel } = harness(booking);

      await resolver.cancelBooking('bk-1', stranger);

      expect(assertMayCancel).toHaveBeenCalledWith(booking, stranger);
      expect(cancel).toHaveBeenCalledWith('bk-1');
    });

    it('never calls cancel when assertMayCancel refuses', async () => {
      const { resolver, cancel, assertMayCancel } = harness(booking);
      assertMayCancel.mockRejectedValueOnce(new ForbiddenException('You are not authorized to cancel this booking.'));

      await expect(resolver.cancelBooking('bk-1', stranger)).rejects.toThrow('You are not authorized to cancel this booking.');
      expect(cancel).not.toHaveBeenCalled();
    });
  });

  describe('a walk-up booking (no jobId)', () => {
    const booking = { _id: 'bk-2', jobId: undefined, nodeId: undefined, ownerSub: 'owner-sub' };

    it('never calls assertMayCancel', async () => {
      const { resolver, assertMayCancel } = harness(booking);

      await resolver.cancelBooking('bk-2', { sub: 'owner-sub', email: 'owner@bu.edu', realm_access: { roles: [] } } as any);

      expect(assertMayCancel).not.toHaveBeenCalled();
    });

    it('refuses a non-owner without inventory:write, with the pre-existing message', async () => {
      const { resolver, cancel, assertMayCancel } = harness(booking);

      await expect(resolver.cancelBooking('bk-2', stranger)).rejects.toThrow('You can only cancel your own bookings.');
      expect(cancel).not.toHaveBeenCalled();
      expect(assertMayCancel).not.toHaveBeenCalled();
    });

    it('allows the owner', async () => {
      const { resolver, cancel } = harness(booking);
      const owner: any = { sub: 'owner-sub', email: 'owner@bu.edu', realm_access: { roles: [] } };

      await resolver.cancelBooking('bk-2', owner);

      expect(cancel).toHaveBeenCalledWith('bk-2');
    });

    it('allows staff holding inventory:write to cancel someone else’s walk-up booking', async () => {
      const { resolver, cancel } = harness(booking);

      await resolver.cancelBooking('bk-2', staff);

      expect(cancel).toHaveBeenCalledWith('bk-2');
    });
  });
});
