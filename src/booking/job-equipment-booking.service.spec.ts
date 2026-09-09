import { JobEquipmentBookingService } from './job-equipment-booking.service';
import { JobBookingAccessStatus } from './job-equipment-booking-access';

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
  it('returns SOW_NOT_SIGNED and no operations while the SOW is only SENT', async () => {
    const view = await build({ sowStatus: 'SENT' }).view('job-1', bookerUser());
    expect(view.access.status).toBe(JobBookingAccessStatus.SOW_NOT_SIGNED);
    expect(view.operations).toEqual([]);
    expect(view.bookings).toEqual([]);
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
    const view = await build({ sowStatus: 'SIGNED' }).view('job-1', user({ sub: 'tech', email: 'tech@bu.edu', realm_access: { roles: ['damplab-staff'] } }));
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
