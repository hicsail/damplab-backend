import { bookingConflictLabel } from './availability.service';

describe('bookingConflictLabel', () => {
  it('names the owner of a walk-up booking, as it always has', () => {
    expect(bookingConflictLabel({ ownerName: 'Jane Doe', ownerEmail: 'jane@bu.edu' })).toBe('booked by Jane Doe');
    expect(bookingConflictLabel({ ownerEmail: 'jane@bu.edu' })).toBe('booked by jane@bu.edu');
    expect(bookingConflictLabel({})).toBe('booked by a user');
  });

  it('redacts a job-scoped booking to a bare reservation', () => {
    expect(bookingConflictLabel({ jobId: 'job-1', ownerName: 'Jane Doe', ownerEmail: 'jane@bu.edu' })).toBe('reserved (equipment booking)');
  });
});
