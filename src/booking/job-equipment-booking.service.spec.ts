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
  it('keeps only equipment-use operations, with their window and hours', async () => {
    const ops = await build().loadOperations(job);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      nodeId: 'node-a',
      label: 'Bioanalyzer time',
      serviceId: 'svc-1',
      window: { start: '2026-01-05', end: '2026-01-09', openEnd: false },
      hoursPerWeek: 6
    });
    expect(ops[0]).not.toHaveProperty('bookers');
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
    findById: async (): Promise<any> => ({ _id: 'bk-1', jobId: 'job-1', nodeId: 'node-a' }),
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

describe('membership is the only way to book (behaviours 5, 6, 8)', () => {
  // nodeEquip stores __equipBookers: ['Booker@BU.edu'] — an old job's retired list.
  const listedStranger = (): any => bookerUser({ sub: 'listed-sub', email: 'booker@bu.edu' });
  const member = (): any => bookerUser({ sub: 'member-sub', email: 'member@bu.edu' });
  const memberJob = { ...job, memberEmails: ['member@bu.edu'] };
  const slotInput = { jobId: 'job-1', nodeId: 'node-a', inventoryItemId: 'item-timed', ...slot };

  it('hides the view from someone the stored list names but who is not on the job', async () => {
    const view = await build({ sowStatus: 'FINAL' }).view('job-1', listedStranger());
    expect(view).toEqual({
      access: { status: JobBookingAccessStatus.HIDDEN, canBook: false, canBlock: false, reason: undefined },
      operations: [],
      bookings: []
    });
  });

  it('refuses their create and update', async () => {
    const { service } = buildWithWriter({ sowStatus: 'FINAL' });
    await expect(service.create(slotInput as any, listedStranger())).rejects.toThrow(ForbiddenException);
    await expect(service.update('bk-1', { ...slot, reason: 'moved' } as any, listedStranger())).rejects.toThrow(ForbiddenException);
  });

  it('opens every operation to a member holding inventory:book, and still lists existing bookings', async () => {
    const view = await build({ sowStatus: 'FINAL', job: memberJob }).view('job-1', member());
    expect(view.access.status).toBe(JobBookingAccessStatus.OPEN);
    expect(view.operations.map((op) => [op.nodeId, op.canBook])).toEqual([['node-a', true]]);
    expect(view.operations[0].bookers).toEqual([]);
    expect(view.bookings.map((b: any) => b._id)).toEqual(['bk-1']);
  });

  it('lets a member create a booking', async () => {
    const { service, written } = buildWithWriter({ sowStatus: 'FINAL', job: memberJob });
    await service.create(slotInput as any, member());
    expect(written[0].nodeId).toBe('node-a');
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
    const svc = new BookingService(model, {} as any, { findItemConflicts: async () => conflicts } as any, {} as any, {} as any);
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

  it("books to the job's owner, falling back to the booker while the client has no account yet", async () => {
    const { svc, created } = make();
    await svc.createForJob({ ...params, job: { ...params.job, sub: undefined } } as any);
    await svc.createForJob({ ...params, job: { ...params.job, sub: 'client-kc' } } as any);
    expect(created[0].ownerSub).toBe('booker-sub');
    expect(created[1].ownerSub).toBe('client-kc');
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

  it('refuses a former listed booker who did not create the booking (behaviour 9)', async () => {
    const { service } = buildWithWriter({ sowStatus: 'FINAL' });
    await expect(service.assertMayCancel(booking, user({ sub: 'x', email: 'BOOKER@bu.edu' }) as any)).rejects.toThrow('You are not authorized to cancel this booking.');
  });

  it('lets a job member cancel', async () => {
    const { service } = buildWithWriter({ sowStatus: 'FINAL', job: { ...job, memberEmails: ['member@bu.edu'] } });
    await expect(service.assertMayCancel(booking, user({ sub: 'member-sub', email: 'member@bu.edu' }) as any)).resolves.toBeUndefined();
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
    const svc = new BookingService(model as any, {} as any, { findItemConflicts: async () => [] } as any, {} as any, {} as any);
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

  it('sends an approved booking back to tentative when a client moves it', async () => {
    const { svc, updates } = buildService();
    await svc.updateForJob('bk-1', { ...move, reason: 'Sample late' }, { sub: 'booker-sub' }, true);
    expect(updates[0].$set.status).toBe('TENTATIVE');
    await svc.updateForJob('bk-1', { ...move, reason: 'Moved by the lab' }, { sub: 'staff-sub' }, false);
    expect(updates[1].$set.status).toBeUndefined();
  });

  it('refuses a client move once the lab has recorded usage', async () => {
    const svc = new BookingService(
      { findById: (): { exec: () => Promise<any> } => ({ exec: async () => ({ ...existing, usageConfirmed: true }) }) } as any,
      {} as any,
      { findItemConflicts: async () => [] } as any,
      {} as any,
      {} as any
    );
    await expect(svc.updateForJob('bk-1', { ...move, reason: 'x' }, {}, true)).rejects.toThrow(/already recorded usage/);
  });

  it('records a cancellation', async () => {
    const { svc, updates } = buildService();
    await svc.cancel('bk-1', { sub: 'booker-sub', name: 'Booker' });
    expect(updates[0].$set.status).toBe('CANCELLED');
    expect(updates[0].$push.history).toMatchObject({ action: 'CANCELLED', bySub: 'booker-sub', byName: 'Booker' });
  });
});

describe('client bookings wait on the lab (tentative)', () => {
  // Where a versioned SOW really keeps them: on its versions. The document's
  // `resources` is the creation-time placeholder (an early version of this
  // feature read the document and so always fell back to every administrator).
  const sow = { _id: 'sow-1', status: 'FINAL', resources: { projectManager: '', projectLead: '' } };
  const versionInputs = { projectManagerId: 'pm-sub', projectLeadId: 'lead-sub' };
  const buildWith = (
    overrides: { sow?: any; bookings?: any; dispatch?: jest.Mock; current?: any; active?: any } = {}
  ): { svc: JobEquipmentBookingService; createForJob: jest.Mock; updateForJob: jest.Mock; dispatch: jest.Mock } => {
    const createForJob = jest.fn(async (p: any) => ({
      _id: 'bk-new',
      jobId: 'job-1',
      inventoryName: 'Bioanalyzer',
      startTime: p.startTime,
      endTime: p.endTime,
      status: p.requiresApproval ? 'TENTATIVE' : 'RESERVED'
    }));
    const updateForJob = jest.fn(async (_id: string, c: any, _a: any, requiresApproval: boolean) => ({
      _id: 'bk-1',
      jobId: 'job-1',
      inventoryName: 'Bioanalyzer',
      ...c,
      status: requiresApproval ? 'TENTATIVE' : 'RESERVED'
    }));
    const dispatch = overrides.dispatch ?? jest.fn();
    const bookings = overrides.bookings ?? { createForJob, updateForJob, findById: async () => ({ _id: 'bk-1', jobId: 'job-1', nodeId: 'node-a' }), findByJob: async () => [] };
    const svc = new JobEquipmentBookingService(
      { findById: async () => job } as any,
      { findByJobId: async () => overrides.sow ?? sow } as any,
      { findById: async () => ({ nodes: ['node-a', 'node-b'] }) } as any,
      { getByIDs: async () => [nodeEquip, nodePlain] } as any,
      { findOne: async (id: string) => (id === 'svc-1' ? equipmentService : plainService) } as any,
      { findByIds: async () => items, find: async (id: string) => items.find((i) => i.id === id) } as any,
      bookings as any,
      { dispatch } as any,
      {
        getCurrentVersion: async (): Promise<any> => ('current' in overrides ? overrides.current : { inputs: versionInputs }),
        getActiveVersion: async (): Promise<any> => overrides.active ?? null
      } as any
    );
    return { svc, createForJob, updateForJob, dispatch };
  };
  const slot = { startTime: new Date('2026-01-06T15:00:00Z'), endTime: new Date('2026-01-06T17:00:00Z') };
  const input = { jobId: 'job-1', nodeId: 'node-a', inventoryItemId: 'item-timed', ...slot } as any;

  it('makes a client’s booking tentative and tells the job’s Project Manager and Project Lead', async () => {
    const { svc, createForJob, dispatch } = buildWith();
    await svc.create(input, bookerUser());
    expect(createForJob.mock.calls[0][0].requiresApproval).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'EQUIPMENT_BOOKING_REQUESTED', jobId: 'job-1', staffSubs: ['pm-sub', 'lead-sub'] }));
    expect(dispatch.mock.calls[0][0].message).toContain('Bioanalyzer · Jan 6, 10:00 AM – Jan 6, 12:00 PM');
  });

  it('names nobody when the SOW names neither, so every administrator hears instead', async () => {
    const { svc, dispatch } = buildWith({ current: { inputs: { projectManager: 'Name only, no account' } } });
    await svc.create(input, bookerUser());
    expect(dispatch.mock.calls[0][0].staffSubs).toEqual([]);
  });

  it('reads the PM and Lead from the newest version, then the one in force, then a pre-versioning document', async () => {
    const { svc } = buildWith();
    expect(await svc.projectStaffSubs(sow)).toEqual(['pm-sub', 'lead-sub']);
    expect(await buildWith({ current: null, active: { inputs: { projectLeadId: 'lead-2' } } }).svc.projectStaffSubs(sow)).toEqual(['lead-2']);
    expect(await buildWith({ current: null }).svc.projectStaffSubs({ _id: 'old', resources: { projectManagerId: 'pm-old', projectLeadId: 'pm-old' } })).toEqual(['pm-old']);
    expect(await svc.projectStaffSubs(null)).toEqual([]);
  });

  it('sends a client’s change back for approval, and says it was a change', async () => {
    const { svc, updateForJob, dispatch } = buildWith();
    await svc.update('bk-1', { ...slot, reason: 'Sample late' } as any, bookerUser());
    expect(updateForJob.mock.calls[0][3]).toBe(true);
    expect(dispatch.mock.calls[0][0]).toMatchObject({ eventType: 'EQUIPMENT_BOOKING_REQUESTED' });
    expect(dispatch.mock.calls[0][0].title).toMatch(/change/i);
  });

  it('lets lab staff book without approval', () => {
    expect(JobEquipmentBookingService.requiresApproval(user({ realm_access: { roles: ['technician'] } }))).toBe(false);
    expect(JobEquipmentBookingService.requiresApproval(user({ realm_access: { roles: ['damplab-staff'] } }))).toBe(false);
    expect(JobEquipmentBookingService.requiresApproval(bookerUser())).toBe(true);
  });

  it('tells the client the answer either way, with the reason on a decline', async () => {
    const approve = jest.fn(async () => ({ _id: 'bk-1', jobId: 'job-1', inventoryName: 'Bioanalyzer', status: 'RESERVED' }));
    const decline = jest.fn(async () => ({ _id: 'bk-1', jobId: 'job-1', inventoryName: 'Bioanalyzer', status: 'CANCELLED' }));
    const { svc, dispatch } = buildWith({ bookings: { approve, decline } });
    const admin = user({ sub: 'admin-sub', realm_access: { roles: ['damplab-staff'] } });
    await svc.approve('bk-1', admin);
    await svc.decline('bk-1', 'Instrument down for service', admin);
    expect(dispatch.mock.calls.map((c) => c[0].eventType)).toEqual(['EQUIPMENT_BOOKING_APPROVED', 'EQUIPMENT_BOOKING_DECLINED']);
    expect(dispatch.mock.calls[1][0].message).toContain('Instrument down for service');
  });
});

describe('BookingService approval', () => {
  const build = (current: any, matches: boolean): { svc: BookingService; calls: any[] } => {
    const calls: any[] = [];
    const model: any = {
      findOneAndUpdate: (filter: any, update: any): { exec: () => Promise<any> } => ({ exec: async () => (calls.push({ filter, update }), matches ? { ...current, ...update.$set } : null) }),
      findById: () => ({ exec: async () => current })
    };
    return { svc: new BookingService(model, {} as any, {} as any, {} as any, {} as any), calls };
  };
  const tentative = { _id: 'bk-1', status: 'TENTATIVE' };

  it('approves only a booking still awaiting approval, and records who', async () => {
    const { svc, calls } = build(tentative, true);
    expect((await svc.approve('bk-1', { sub: 'admin', name: 'Admin' })).status).toBe('RESERVED');
    expect(calls[0].filter).toEqual({ _id: 'bk-1', status: 'TENTATIVE' });
    expect(calls[0].update.$push.history).toMatchObject({ action: 'APPROVED', bySub: 'admin' });
  });

  it('declines into a cancellation that frees the slot, and needs a reason', async () => {
    const { svc, calls } = build(tentative, true);
    await expect(svc.decline('bk-1', '  ')).rejects.toThrow(/reason is required/);
    expect((await svc.decline('bk-1', 'Instrument down', { sub: 'admin' })).status).toBe('CANCELLED');
    expect(calls[0].update.$push.history).toMatchObject({ action: 'DECLINED', reason: 'Instrument down' });
  });

  it('refuses when the client cancelled or it was already answered in the meantime', async () => {
    await expect(build({ _id: 'bk-1', status: 'CANCELLED' }, false).svc.approve('bk-1')).rejects.toThrow('no longer awaiting approval');
    await expect(build(null, false).svc.decline('bk-1', 'x')).rejects.toThrow('Booking not found.');
  });

  it('will not record usage on a tentative booking', async () => {
    await expect(build(tentative, true).svc.confirmUsage('bk-1', 2, null)).rejects.toThrow(/Approve this booking/);
  });
});

describe('ended bookings and the usage trail', () => {
  const ended = { _id: 'bk-9', kind: 'TIMED', status: 'RESERVED', billingStatus: 'UNBILLED', startTime: new Date('2026-01-06T10:00:00Z'), endTime: new Date('2026-01-06T12:00:00Z'), rateSnapshot: 40 };
  const build = (doc: any): { svc: BookingService; updates: any[] } => {
    const updates: any[] = [];
    const model: any = {
      findById: (): { exec: () => Promise<any> } => ({ exec: async () => doc }),
      findByIdAndUpdate: (_id: string, update: any): { exec: () => Promise<any> } => ({ exec: async () => (updates.push(update), { ...doc, ...update.$set }) })
    };
    return { svc: new BookingService(model, {} as any, {} as any, {} as any, {} as any), updates };
  };

  it('refuses to cancel a booking that has ended, for anyone', async () => {
    const { svc, updates } = build(ended);
    await expect(svc.cancel('bk-9', { sub: 'admin' }, new Date('2026-01-06T12:00:00Z'))).rejects.toThrow(/already ended/);
    expect(updates).toEqual([]);
  });

  it('still cancels one that has not ended — including one already running', async () => {
    const { svc, updates } = build(ended);
    await svc.cancel('bk-9', { sub: 'admin' }, new Date('2026-01-06T11:00:00Z'));
    expect(updates[0].$set.status).toBe('CANCELLED');
  });

  it('records each usage confirmation in the history, with who and the hours', async () => {
    const { svc, updates } = build(ended);
    await svc.confirmUsage('bk-9', 1.5, null, 'Test Admin', 'admin-sub');
    expect(updates[0].$push.history).toMatchObject({ action: 'USAGE_CONFIRMED', bySub: 'admin-sub', byName: 'Test Admin', actualHours: 1.5 });
    expect(updates[0].$set.cost).toBe(60);
  });
});
