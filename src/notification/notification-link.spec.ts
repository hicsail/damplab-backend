import { notificationLink } from './notification.constants';

describe('notificationLink', () => {
  it('sends staff-only events, including a booking awaiting approval, to the staff job page', () => {
    expect(notificationLink('EQUIPMENT_BOOKING_REQUESTED', 'job-1')).toBe('/technician_view/job-1');
    expect(notificationLink('JOB_SUBMITTED', 'job-1')).toBe('/technician_view/job-1');
  });

  it('keeps events that reach a client on the client page', () => {
    expect(notificationLink('EQUIPMENT_BOOKING_APPROVED', 'job-1')).toBe('/client_view/job-1');
    expect(notificationLink('COMMENT_CREATED', 'job-1')).toBe('/client_view/job-1');
    expect(notificationLink('UNKNOWN', 'job-1')).toBe('/client_view/job-1');
    expect(notificationLink('JOB_SUBMITTED')).toBeUndefined();
  });
});
