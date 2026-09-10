import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JobEquipmentBookingService } from './job-equipment-booking.service';
import { JobBookingAccessStatus } from './job-equipment-booking-access';
import { BookingService } from './booking.service';

const equipmentService = {
  _id: 'svc-1',
  name: 'Bioanalyzer time',
  equipmentUse: true,
  inventoryRequirements: ['item-timed', 'item-consumable', 'item-unbookable'],
  pricing: { internal: 40 }
};
const plainService = { _id: 'svc-2', name: 'PCR', equipmentUse: false, inventoryRequirements: [] };

const nodeEquip = {
  _id: 'node-a',
  label: 'Bioanalyzer time',
  service: 'svc-1',
  formData: [
    { id: '__equipStart', value: '2026-01-05' },
    { id: '__equipEnd', value: '2026-01-09' },
    { id: '__equipOpenEnd', value: false },
    { id: '__equipHoursPerWeek', value: 6 },
    { id: '__equipBookers', value: ['Booker@BU.edu'] }
  ]
};
const nodePlain = { _id: 'node-b', label: 'PCR', service: 'svc-2', formData: [] };

const items = [
  { id: 'item-timed', name: 'Bioanalyzer', type: 'EQUIPMENT', bookable: true, rateType: 'HOURLY' },
  { id: 'item-consumable', name: 'Reagent kit', type: 'CONSUMABLE', bookable: true, rateType: 'PER_UNIT' },
  { id: 'item-unbookable', name: 'Bench', type: 'EQUIPMENT', bookable: false }
];

const job = { _id: 'job-1', jobId: '04217', sub: 'creator-sub', email: 'creator@bu.edu', clientEmail: 'client@bu.edu', workflows: ['wf-1'] };

const build = (over: { sowStatus?: string; job?: any } = {}): JobEquipmentBookingService =>
  new JobEquipmentBookingService(
    { findById: async () => over.job ?? job } as any,
    { findByJobId: async () => (over.sowStatus ? { status: over.sowStatus } : null) } as any,
    { findById: async () => ({ nodes: ['node-a', 'node-b'] }) } as any,
    { getByIDs: async () => [nodeEquip, nodePlain] } as any,
    { findOne: async (id: string) => (id === 'svc-1' ? equipmentService : plainService) } as any,
    { findByIds: async () => items, find: async (id: string) => items.find((i) => i.id === id) } as any,
    { findByJob: async () => [{ _id: 'bk-1', jobId: 'job-1', nodeId: 'node-a' }] } as any
  );

const user = (over: any = {}): any => ({ sub: 'creator-sub', email: 'creator@bu.edu', realm_access: { roles: [] }, ...over });

/**
 * The job's creator, holding `inventory:book` and NOT `jobs:view-all`.
 *
 * `client-unassisted-equipment-user` is the only role with that shape (see
 * `EQUIPMENT_USER` in src/auth/permissions/role-permissions.ts). It matters: a
 * `damplab-staff` caller takes the read-only STAFF branch of the verdict, whose
 * `bookableNodeIds` is empty by design — so a staff fixture proves nothing about
 * booking and would be refused by `authorize`.
 */
const bookerUser = (over: any = {}): any => user({ sub: 'creator-sub', email: 'creator@bu.edu', realm_access: { roles: ['client-unassisted-equipment-user'] }, ...over });

describe('JobEquipmentBookingService.loadOperations', () => {
  it('keeps only equipment-use operations, with their window, hours and bookers', async () => {
    const ops = await build().loadOperations(job);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      nodeId: 'node-a',
      label: 'Bioanalyzer time',
      serviceId: 'svc-1',
      window: { start: '2026-01-05', end: '2026-01-09', openEnd: false },
      hoursPerWeek: 6,
      bookers: ['booker@bu.edu']
    });
  });

  it('lists the bookable items and marks only the timed one schedulable', async () => {
    const ops = await build().loadOperations(job);
    expect(ops[0].items).toEqual([
      { id: 'item-timed', name: 'Bioanalyzer', rateType: 'HOURLY', schedulable: true },
      { id: 'item-consumable', name: 'Reagent kit', rateType: 'PER_UNIT', schedulable: false }
    ]);
  });
});

describe('JobEquipmentBookingService.view', () => {
  it('returns SOW_NOT_SIGNED while the SOW is signed but not yet countersigned', async () => {
    const view = await build({ sowStatus: 'SIGNED' }).view('job-1', bookerUser());
    expect(view.access.status).toBe(JobBookingAccessStatus.SOW_NOT_SIGNED);
    expect(view.operations.map((op) => [op.nodeId, op.canBook])).toEqual([['node-a', false]]);
    expect(view.bookings.map((b: any) => b._id)).toEqual(['bk-1']);
  });

  it('still refuses while the SOW has only been sent', async () => {
    const view = await build({ sowStatus: 'SENT' }).view('job-1', bookerUser());
    expect(view.access.status).toBe(JobBookingAccessStatus.SOW_NOT_SIGNED);
  });

  it('keeps listing the bookings while the lab has paused the job', async () => {
    const view = await build({ sowStatus: 'FINAL', job: { ...job, bookingBlocked: true, bookingBlockedReason: 'Maintenance' } }).view('job-1', bookerUser());
    expect(view.access.status).toBe(JobBookingAccessStatus.BLOCKED);
    expect(view.operations[0].canBook).toBe(false);
    expect(view.bookings.map((b: any) => b._id)).toEqual(['bk-1']);
  });

  /**
   * `resolveJobEquipmentBookingAccess` (Task 2, landed) checks `hasInventoryBook`
   * unconditionally, ahead of the SOW check, even for the job's own owner — the
   * documented precedence is `HIDDEN > NOT_ELIGIBLE > SOW_NOT_SIGNED > BLOCKED >
   * OPEN`. So an owner with no `inventory:book` sees NOT_ELIGIBLE regardless of SOW
   * status. Pinned here so the discrepancy from a plain-`user()` fixture is asserted
   * in code, not just noted in a report.
   */
  it('tells an owner without inventory:book to ask for access, ahead of the SOW', async () => {
    const view = await build({ sowStatus: 'SENT' }).view('job-1', user());
    expect(view.access.status).toBe(JobBookingAccessStatus.NOT_ELIGIBLE);
  });

  it('opens once the SOW is FINAL, for a creator holding inventory:book', async () => {
    const view = await build({ sowStatus: 'FINAL' }).view('job-1', bookerUser());
    expect(view.access.status).toBe(JobBookingAccessStatus.OPEN);
    expect(view.access.canBook).toBe(true);
    expect(view.operations.map((op) => op.nodeId)).toEqual(['node-a']);
    expect(view.operations[0].canBook).toBe(true);
  });

  it('gives jobs:view-all staff the same status, read-only', async () => {
    const view = await build({ sowStatus: 'FINAL' }).view('job-1', user({ sub: 'tech', email: 'tech@bu.edu', realm_access: { roles: ['damplab-staff'] } }));
    expect(view.access.status).toBe(JobBookingAccessStatus.OPEN);
    expect(view.access.canBook).toBe(false);
    expect(view.operations[0].canBook).toBe(false);
  });

  it('tells a stranger nothing at all', async () => {
    const view = await build({ sowStatus: 'SIGNED' }).view('job-1', user({ sub: 'nobody', email: 'nobody@bu.edu' }));
    expect(view).toEqual({
      access: { status: JobBookingAccessStatus.HIDDEN, canBook: false, canBlock: false, reason: undefined },
      operations: [],
      bookings: []
    });
  });
});

/** As `build`, but with a spying booking service so the write can be asserted. */
const buildWithWriter = (over: { sowStatus?: string; job?: any } = {}): { service: JobEquipmentBookingService; written: any[] } => {
  const written: any[] = [];
  const bookings = {
    findByJob: async (): Promise<any[]> => [],
    createForJob: async (params: any): Promise<{ _id: string }> => {
      written.push(params);
      return { _id: 'bk-new' };
    }
  };
  const service = new JobEquipmentBookingService(
    { findById: async () => over.job ?? job } as any,
    { findByJobId: async () => (over.sowStatus ? { status: over.sowStatus } : null) } as any,
    { findById: async () => ({ nodes: ['node-a', 'node-b'] }) } as any,
    { getByIDs: async () => [nodeEquip, nodePlain] } as any,
    { findOne: async (id: string) => (id === 'svc-1' ? equipmentService : plainService) } as any,
    // `loadOperations` uses findByIds; `create` re-reads the chosen item with find.
    { findByIds: async () => items, find: async (id: string) => items.find((i) => i.id === id) } as any,
    bookings as any
  );
  return { service, written };
};

const slot = { startTime: new Date('2026-01-06T10:00:00Z'), endTime: new Date('2026-01-06T12:00:00Z') };

describe('JobEquipmentBookingService.create', () => {
  const input = { jobId: 'job-1', nodeId: 'node-a', inventoryItemId: 'item-timed', ...slot };

  it('hands the booking service the job, the operation and the schedulable item', async () => {
    const { service, written } = buildWithWriter({ sowStatus: 'FINAL' });
    await service.create(input as any, bookerUser() as any);
    expect(written[0]).toMatchObject({ nodeId: 'node-a', nodeLabel: 'Bioanalyzer time' });
    expect(written[0].job._id).toBe('job-1');
    expect(written[0].item.id).toBe('item-timed');
    expect(written[0].service._id).toBe('svc-1');
  });

  it('refuses while the SOW is unsigned', async () => {
    const { service } = buildWithWriter({ sowStatus: 'SENT' });
    await expect(service.create(input as any, bookerUser() as any)).rejects.toThrow(ForbiddenException);
  });

  it('refuses with the lab wording while booking is paused', async () => {
    const paused = { ...job, bookingBlocked: true, bookingBlockedReason: 'unpaid invoice' };
    const { service } = buildWithWriter({ sowStatus: 'FINAL', job: paused });
    await expect(service.create(input as any, bookerUser() as any)).rejects.toThrow('Booking on this job is paused by the lab.');
  });

  it('refuses a consumable, which is bookable but not schedulable here', async () => {
    const { service } = buildWithWriter({ sowStatus: 'FINAL' });
    await expect(service.create({ ...input, inventoryItemId: 'item-consumable' } as any, bookerUser() as any)).rejects.toThrow(BadRequestException);
  });

  it('refuses an operation that is not on this job', async () => {
    const { service } = buildWithWriter({ sowStatus: 'FINAL' });
    await expect(service.create({ ...input, nodeId: 'node-zzz' } as any, bookerUser() as any)).rejects.toThrow('That operation is not on this job.');
  });
});

describe('BookingService.createForJob', () => {
  const make = (conflicts: any[] = []): { svc: BookingService; created: any[] } => {
    const created: any[] = [];
    // Stands in for the Mongoose model, which is called as `new this.model(doc)`
    // by some collaborators; `createForJob` only ever calls `.create`, so the
    // constructor body itself does nothing.
    const model: any = function (): void {
      /* unused: createForJob only calls model.create */
    };
    model.create = async (doc: any): Promise<any> => {
      created.push(doc);
      return doc;
    };
    const svc = new BookingService(model, {} as any, { findItemConflicts: async () => conflicts } as any, {} as any);
    return { svc, created };
  };

  const params = {
    job: { _id: 'job-1', jobId: '04217', sub: 'creator-sub', email: 'creator@bu.edu', username: 'Creator', institute: 'BU', customerCategory: 'INTERNAL_CUSTOMERS' },
    nodeId: 'node-a',
    nodeLabel: 'Bioanalyzer time',
    service: { _id: 'svc-1', pricing: { internal: 40 } },
    item: { id: 'item-timed', name: 'Bioanalyzer', type: 'EQUIPMENT', bookable: true, rateType: 'HOURLY' },
    startTime: new Date('2026-01-06T10:00:00Z'),
    endTime: new Date('2026-01-06T12:00:00Z'),
    actor: { sub: 'booker-sub', name: 'Booker' }
  };

  it("takes the owner from the job and the rate from the operation's service price", async () => {
    const { svc, created } = make();
    await svc.createForJob(params as any);
    expect(created[0]).toMatchObject({
      jobId: 'job-1',
      nodeId: 'node-a',
      serviceId: 'svc-1',
      ownerSub: 'creator-sub',
      ownerEmail: 'creator@bu.edu',
      ownerInstitution: 'BU',
      customerCategory: 'INTERNAL_CUSTOMERS',
      createdBySub: 'booker-sub',
      rateSnapshot: 40,
      cost: 80,
      notes: 'Job #04217 · Bioanalyzer time'
    });
  });

  it('leaves rate and cost undefined when the category resolves no price', async () => {
    const { svc, created } = make();
    await svc.createForJob({ ...params, service: { _id: 'svc-1', pricing: {} } } as any);
    expect(created[0].rateSnapshot).toBeUndefined();
    expect(created[0].cost).toBeUndefined();
  });

  it('refuses a slot that overlaps any other hold on the item', async () => {
    const { svc } = make([{ itemId: 'item-timed', source: 'BOOKING', label: 'reserved (equipment booking)' }]);
    await expect(svc.createForJob(params as any)).rejects.toThrow('That item is unavailable for the selected time (reserved (equipment booking)).');
  });

  it('surfaces the item-deleted guard, not the conflict message, when both apply', async () => {
    // Regression: a deleted item with a conflicting window must fail on the
    // item.isDeleted guard, which runs before the availability check.
    const { svc } = make([{ itemId: 'item-timed', source: 'BOOKING', label: 'reserved (equipment booking)' }]);
    const deletedItem = { ...params.item, isDeleted: true };
    await expect(svc.createForJob({ ...params, item: deletedItem } as any)).rejects.toThrow('That inventory item is no longer available.');
  });
});

describe('JobEquipmentBookingService.assertMayCancel', () => {
  const booking = { _id: 'bk-1', jobId: 'job-1', nodeId: 'node-a', ownerSub: 'creator-sub', createdBySub: 'booker-sub' };

  it('lets the job creator cancel', async () => {
    const { service } = buildWithWriter({ sowStatus: 'FINAL' });
    await expect(service.assertMayCancel(booking, user({ sub: 'creator-sub', email: 'creator@bu.edu' }) as any)).resolves.toBeUndefined();
  });

  it('lets a listed booker of that operation cancel', async () => {
    const { service } = buildWithWriter({ sowStatus: 'FINAL' });
    await expect(service.assertMayCancel(booking, user({ sub: 'x', email: 'BOOKER@bu.edu' }) as any)).resolves.toBeUndefined();
  });

  it('lets whoever made the booking cancel it', async () => {
    const { service } = buildWithWriter({ sowStatus: 'FINAL' });
    await expect(service.assertMayCancel(booking, user({ sub: 'booker-sub', email: 'someone@bu.edu' }) as any)).resolves.toBeUndefined();
  });

  it('lets jobs:view-all staff cancel', async () => {
    const { service } = buildWithWriter({ sowStatus: 'FINAL' });
    await expect(service.assertMayCancel(booking, user({ sub: 'x', email: 'tech@bu.edu', realm_access: { roles: ['damplab-staff'] } }) as any)).resolves.toBeUndefined();
  });

  it('refuses anyone else', async () => {
    const { service } = buildWithWriter({ sowStatus: 'FINAL' });
    await expect(service.assertMayCancel(booking, user({ sub: 'x', email: 'nobody@bu.edu' }) as any)).rejects.toThrow('You are not authorized to cancel this booking.');
  });

  /**
   * The one eligible class the five tests above never touch: a caller who is not
   * the job creator, not the booking's creator, not a listed booker and holds no
   * staff permission — eligible solely because `job.clientEmail` names them. Case-
   * and whitespace-insensitively, per `matchesClientEmail`, so this also pins the
   * argument order (`matchesClientEmail(job.clientEmail, actor.email)`): swapped,
   * this still "matches" only by accident and only when the two strings are equal,
   * which they deliberately are not here.
   */
  it('lets a caller whose only claim is a client-email match cancel', async () => {
    const { service } = buildWithWriter({ sowStatus: 'FINAL' });
    await expect(service.assertMayCancel(booking, user({ sub: 'client-caller', email: '  Client@BU.edu  ' }) as any)).resolves.toBeUndefined();
  });

  it('refuses a caller whose email is close to, but does not match, the client email', async () => {
    const { service } = buildWithWriter({ sowStatus: 'FINAL' });
    await expect(service.assertMayCancel(booking, user({ sub: 'client-caller', email: 'client@bu.edu.evil.com' }) as any)).rejects.toThrow('You are not authorized to cancel this booking.');
  });
});

describe('BookingService.updateForJob history', () => {
  const existing = {
    _id: 'bk-1',
    jobId: 'job-1',
    inventoryItem: 'item-timed',
    status: 'RESERVED',
    billingStatus: 'UNBILLED',
    startTime: new Date('2026-01-06T10:00:00Z'),
    endTime: new Date('2026-01-06T12:00:00Z'),
    notes: 'Job #04217 · Bioanalyzer time',
    rateSnapshot: 40
  };
  const buildService = (): { svc: BookingService; updates: any[] } => {
    const updates: any[] = [];
    const model = {
      findById: () => ({ exec: async () => existing }),
      findByIdAndUpdate: (_id: string, update: any): { exec: () => Promise<any> } => {
        updates.push(update);
        return { exec: async () => ({ ...existing, ...update.$set }) };
      }
    };
    const svc = new BookingService(model as any, {} as any, { findItemConflicts: async () => [] } as any, {} as any);
    return { svc, updates };
  };
  const move = { startTime: new Date('2026-01-07T10:00:00Z'), endTime: new Date('2026-01-07T11:00:00Z') };

  it('refuses a change without a reason', async () => {
    const { svc } = buildService();
    await expect(svc.updateForJob('bk-1', { ...move, reason: '  ' })).rejects.toThrow('A reason is required to change a booking.');
  });

  it('records who moved it, from what, and why', async () => {
    const { svc, updates } = buildService();
    await svc.updateForJob('bk-1', { ...move, reason: 'Sample arrives a day late' }, { sub: 'booker-sub', name: 'Booker' });
    expect(updates).toHaveLength(1);
    expect(updates[0].$push.history).toMatchObject({
      action: 'UPDATED',
      bySub: 'booker-sub',
      byName: 'Booker',
      reason: 'Sample arrives a day late',
      previousStartTime: existing.startTime,
      previousEndTime: existing.endTime,
      previousNotes: existing.notes
    });
    expect(updates[0].$set.cost).toBe(40);
  });

  it('records a cancellation', async () => {
    const { svc, updates } = buildService();
    await svc.cancel('bk-1', { sub: 'booker-sub', name: 'Booker' });
    expect(updates[0].$set.status).toBe('CANCELLED');
    expect(updates[0].$push.history).toMatchObject({ action: 'CANCELLED', bySub: 'booker-sub', byName: 'Booker' });
  });
});
