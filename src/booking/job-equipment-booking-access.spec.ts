import { AccessActor, AccessOperation, JobBookingAccessStatus, resolveJobEquipmentBookingAccess } from './job-equipment-booking-access';

const job = { sub: 'creator-sub', clientEmail: 'Client@BU.edu' };
const ops: AccessOperation[] = [
  { nodeId: 'node-a', bookers: ['booker@bu.edu'] },
  { nodeId: 'node-b', bookers: [] }
];

const actor = (over: Partial<AccessActor> = {}): AccessActor => ({
  sub: 'stranger-sub',
  email: 'stranger@bu.edu',
  hasInventoryBook: false,
  hasJobsViewAll: false,
  hasBillingView: false,
  ...over
});

describe('resolveJobEquipmentBookingAccess', () => {
  it('gives the job creator with inventory:book every operation', () => {
    const v = resolveJobEquipmentBookingAccess(job, actor({ sub: 'creator-sub', hasInventoryBook: true }), ops, true);
    expect(v.status).toBe(JobBookingAccessStatus.OPEN);
    expect(v.canBook).toBe(true);
    expect(v.bookableNodeIds).toEqual(['node-a', 'node-b']);
  });

  it('matches the client email case-insensitively and with padding', () => {
    const v = resolveJobEquipmentBookingAccess(job, actor({ email: '  client@bu.EDU ', hasInventoryBook: true }), ops, true);
    expect(v.bookableNodeIds).toEqual(['node-a', 'node-b']);
  });

  it('gives a listed booker only the operation they are listed on', () => {
    const v = resolveJobEquipmentBookingAccess(job, actor({ email: 'BOOKER@bu.edu', hasInventoryBook: true }), ops, true);
    expect(v.status).toBe(JobBookingAccessStatus.OPEN);
    expect(v.canBook).toBe(true);
    expect(v.bookableNodeIds).toEqual(['node-a']);
  });

  it('tells a listed booker without the role to ask for access', () => {
    const v = resolveJobEquipmentBookingAccess(job, actor({ email: 'booker@bu.edu' }), ops, true);
    expect(v.status).toBe(JobBookingAccessStatus.NOT_ELIGIBLE);
    expect(v.canBook).toBe(false);
    expect(v.bookableNodeIds).toEqual([]);
  });

  it('hides the job from a stranger, signed or not, blocked or not', () => {
    const blockedJob = { ...job, bookingBlocked: true, bookingBlockedReason: 'unpaid invoice' };
    const v = resolveJobEquipmentBookingAccess(blockedJob, actor({ hasInventoryBook: true }), ops, false);
    expect(v).toEqual({ status: JobBookingAccessStatus.HIDDEN, canBook: false, canBlock: false, bookableNodeIds: [] });
  });

  it('gives jobs:view-all staff the real verdict, read-only', () => {
    const v = resolveJobEquipmentBookingAccess(job, actor({ hasJobsViewAll: true, hasBillingView: true }), ops, true);
    expect(v.status).toBe(JobBookingAccessStatus.OPEN);
    expect(v.canBook).toBe(false);
    expect(v.canBlock).toBe(true);
    expect(v.bookableNodeIds).toEqual([]);
  });

  it('reports SOW_NOT_SIGNED before BLOCKED', () => {
    const blockedJob = { ...job, bookingBlocked: true, bookingBlockedReason: 'unpaid invoice' };
    const v = resolveJobEquipmentBookingAccess(blockedJob, actor({ sub: 'creator-sub', hasInventoryBook: true }), ops, false);
    expect(v.status).toBe(JobBookingAccessStatus.SOW_NOT_SIGNED);
  });

  it('reports BLOCKED with the lab reason once the SOW is signed', () => {
    const blockedJob = { ...job, bookingBlocked: true, bookingBlockedReason: 'unpaid invoice' };
    const v = resolveJobEquipmentBookingAccess(blockedJob, actor({ sub: 'creator-sub', hasInventoryBook: true }), ops, true);
    expect(v).toEqual({
      status: JobBookingAccessStatus.BLOCKED,
      canBook: false,
      canBlock: false,
      reason: 'unpaid invoice',
      bookableNodeIds: []
    });
  });

  it('is OPEN but unbookable when the job has no equipment-use operations', () => {
    const v = resolveJobEquipmentBookingAccess(job, actor({ sub: 'creator-sub', hasInventoryBook: true }), [], true);
    expect(v.status).toBe(JobBookingAccessStatus.OPEN);
    expect(v.canBook).toBe(false);
  });
});
