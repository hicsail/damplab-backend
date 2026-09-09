import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { JobService } from '../job/job.service';
import { SOWService } from '../sow/sow.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowNodeService } from '../workflow/services/node.service';
import { DampLabServices } from '../services/damplab-services.services';
import { InventoryService } from '../inventory/inventory.service';
import { BookingService } from './booking.service';
import { Permission } from '../auth/permissions/permission.enum';
import { hasPermission } from '../auth/permissions/permissions';
import { User } from '../auth/user.interface';
import { EquipmentWindow, readEquipmentBookers, readEquipmentHoursPerWeek, readEquipmentWindow } from './equipment-window';
import { AccessActor, JobBookingAccessStatus, JobBookingAccessVerdict, resolveJobEquipmentBookingAccess } from './job-equipment-booking-access';
import { JobBookingItem, JobEquipmentBookingView } from './dtos/job-equipment-booking.types';
import { Booking } from './booking.model';
import { CreateJobEquipmentBookingInput, UpdateJobEquipmentBookingInput } from './dtos/job-equipment-booking.input';
import { matchesClientEmail } from '../job/client-email';
import { normalizeBookerEmails } from './booker-emails';

/** One equipment-use operation of a job, with everything the panel and the mutations need. */
export interface LoadedOperation {
  nodeId: string;
  label: string;
  serviceId?: string;
  service: any;
  window: EquipmentWindow;
  hoursPerWeek?: number;
  bookers: string[];
  items: JobBookingItem[];
}

/**
 * A SOW counts as signed at SIGNED and stays signed at FINAL. Countersigning must
 * not close booking the moment the paperwork completes — see
 * SOWService.findSignedJobIds, which draws the same line for the lab boards.
 */
const SIGNED_STATUSES = new Set(['SIGNED', 'FINAL']);

/**
 * Whether a bookable item can be reserved as a time slot from the job calendar.
 *
 * The same rule BookingService.inferKind uses, deliberately: an item whose
 * rateType was never set is TIMED unless it is a consumable, and a job calendar
 * that disagreed with the booking service would offer slots the create then
 * refused.
 */
const isSchedulable = (item: any): boolean => (item?.rateType ? item.rateType === 'HOURLY' : item?.type !== 'CONSUMABLE');

@Injectable()
export class JobEquipmentBookingService {
  constructor(
    @Inject(forwardRef(() => JobService)) private readonly jobService: JobService,
    @Inject(forwardRef(() => SOWService)) private readonly sowService: SOWService,
    private readonly workflowService: WorkflowService,
    private readonly workflowNodeService: WorkflowNodeService,
    private readonly services: DampLabServices,
    private readonly inventory: InventoryService,
    private readonly bookings: BookingService
  ) {}

  /** The permission-bearing half of the caller, for the pure verdict function. */
  actorFor(user?: User): AccessActor {
    return {
      sub: user?.sub,
      email: user?.email,
      hasInventoryBook: hasPermission(user, Permission.InventoryBook),
      hasJobsViewAll: hasPermission(user, Permission.JobsViewAll),
      hasBillingView: hasPermission(user, Permission.BillingView)
    };
  }

  async isSowSigned(jobId: string): Promise<boolean> {
    const sow = await this.sowService.findByJobId(jobId);
    return !!sow && SIGNED_STATUSES.has(String((sow as any).status));
  }

  /**
   * The job's equipment-use operations, in workflow-then-node order.
   *
   * Walks job -> workflows -> nodes the way SOWService.collectSowServiceInputs
   * does, because that is the one existing traversal and the two must agree on
   * what "the job's operations" means. `getByIDs` does not populate `service`, so
   * each distinct service is fetched by id — with `findOne`, not `findByIds`,
   * because a service soft-deleted from the catalog after submission must not
   * silently drop an operation the customer already paid for.
   */
  async loadOperations(job: any): Promise<LoadedOperation[]> {
    const nodes: any[] = [];
    for (const workflowId of job.workflows ?? []) {
      const workflow = await this.workflowService.findById(String(workflowId));
      if (!workflow) continue;
      const nodeIds = ((workflow as any).nodes ?? []).map((n: any) => String(n));
      if (!nodeIds.length) continue;
      nodes.push(...(await this.workflowNodeService.getByIDs(nodeIds)));
    }

    const serviceById = new Map<string, any>();
    for (const node of nodes) {
      const id = String((node as any).service?._id ?? (node as any).service ?? '');
      if (!id || id === 'undefined' || id === 'null' || serviceById.has(id)) continue;
      serviceById.set(id, await this.services.findOne(id));
    }

    const operations: LoadedOperation[] = [];
    for (const node of nodes) {
      const serviceId = String((node as any).service?._id ?? (node as any).service ?? '');
      const service = serviceById.get(serviceId);
      if (!service || service.equipmentUse !== true) continue;

      const requirementIds = ((service.inventoryRequirements ?? []) as any[]).map((id) => String(id));
      const required = requirementIds.length ? await this.inventory.findByIds(requirementIds) : [];
      const items: JobBookingItem[] = (required as any[])
        .filter((item) => item?.bookable === true)
        .map((item) => ({ id: String(item.id), name: item.name, rateType: item.rateType, schedulable: isSchedulable(item) }));

      operations.push({
        nodeId: String((node as any)._id),
        label: (node as any).label ?? service.name ?? 'Operation',
        serviceId: serviceId || undefined,
        service,
        window: readEquipmentWindow((node as any).formData),
        hoursPerWeek: readEquipmentHoursPerWeek((node as any).formData),
        bookers: readEquipmentBookers((node as any).formData),
        items
      });
    }
    return operations;
  }

  async verdict(job: any, user: User, operations: LoadedOperation[]): Promise<JobBookingAccessVerdict> {
    const signed = await this.isSowSigned(String(job._id));
    return resolveJobEquipmentBookingAccess(
      { sub: job.sub, clientEmail: job.clientEmail, bookingBlocked: job.bookingBlocked, bookingBlockedReason: job.bookingBlockedReason },
      this.actorFor(user),
      operations.map((op) => ({ nodeId: op.nodeId, bookers: op.bookers })),
      signed
    );
  }

  /** The refusal a non-OPEN verdict earns on a write. */
  private refuse(verdict: JobBookingAccessVerdict): never {
    if (verdict.status === JobBookingAccessStatus.BLOCKED) throw new ForbiddenException('Booking on this job is paused by the lab.');
    if (verdict.status === JobBookingAccessStatus.SOW_NOT_SIGNED) {
      throw new ForbiddenException('Booking opens once the Statement of Work is signed by both parties.');
    }
    // HIDDEN and NOT_ELIGIBLE deliberately share one refusal: telling a stranger
    // which of the two applies would tell them the job exists.
    throw new ForbiddenException('You are not authorized to book equipment on this job.');
  }

  /** The job, the operation and the caller's right to book it — or a refusal. */
  private async authorize(jobId: string, nodeId: string, user: User): Promise<{ job: any; operation: LoadedOperation }> {
    const job: any = await this.jobService.findById(jobId);
    if (!job) throw new NotFoundException('Job not found.');
    const operations = await this.loadOperations(job);
    const verdict = await this.verdict(job, user, operations);
    if (verdict.status !== JobBookingAccessStatus.OPEN) this.refuse(verdict);

    const operation = operations.find((op) => op.nodeId === nodeId);
    if (!operation) throw new NotFoundException('That operation is not on this job.');
    if (!verdict.bookableNodeIds.includes(nodeId)) throw new ForbiddenException('You are not authorized to book this operation.');
    return { job, operation };
  }

  async create(input: CreateJobEquipmentBookingInput, user: User): Promise<Booking> {
    const { job, operation } = await this.authorize(String(input.jobId), String(input.nodeId), user);
    const item = operation.items.find((i) => i.id === String(input.inventoryItemId));
    if (!item) throw new BadRequestException('That item is not required by this operation.');
    if (!item.schedulable) throw new BadRequestException('That item is not schedulable here — consumables are billed by quantity, not by time slot.');

    const full = await this.inventory.find(item.id);
    if (!full) throw new NotFoundException('Inventory item not found.');

    return this.bookings.createForJob({
      job,
      nodeId: operation.nodeId,
      nodeLabel: operation.label,
      service: operation.service,
      item: full,
      startTime: input.startTime,
      endTime: input.endTime,
      notes: input.notes,
      actor: { sub: user?.sub, email: user?.email, name: user?.preferred_username || user?.email }
    });
  }

  async update(id: string, input: UpdateJobEquipmentBookingInput, user: User): Promise<Booking> {
    const existing: any = await this.bookings.findById(id);
    if (!existing) throw new NotFoundException('Booking not found.');
    if (!existing.jobId) throw new BadRequestException('That booking is not attached to a job.');
    await this.authorize(String(existing.jobId), String(existing.nodeId), user);
    return this.bookings.updateForJob(id, { startTime: input.startTime, endTime: input.endTime, notes: input.notes });
  }

  async view(jobId: string, user: User): Promise<JobEquipmentBookingView> {
    const job: any = await this.jobService.findById(jobId);
    if (!job) throw new NotFoundException('Job not found.');

    const operations = await this.loadOperations(job);
    const verdict = await this.verdict(job, user, operations);
    const access = { status: verdict.status, canBook: verdict.canBook, canBlock: verdict.canBlock, reason: verdict.reason };

    // Anything short of OPEN gets the status and nothing else. A locked panel that
    // still listed the operations, the items and the bookers would leak most of
    // what the panel is for.
    if (verdict.status !== JobBookingAccessStatus.OPEN) {
      return { access, operations: [], bookings: [] };
    }

    return {
      access,
      operations: operations.map((op) => ({
        nodeId: op.nodeId,
        label: op.label,
        serviceId: op.serviceId,
        canBook: verdict.bookableNodeIds.includes(op.nodeId),
        window: { start: op.window.start, end: op.window.end, openEnd: op.window.openEnd },
        hoursPerWeek: op.hoursPerWeek,
        items: op.items,
        bookers: op.bookers
      })),
      bookings: await this.bookings.findByJob(String(job._id))
    };
  }

  /**
   * Who may cancel a job-scoped booking.
   *
   * Wider than the walk-up rule (owner-only) and deliberately so: the booking's
   * owner is the JOB, so its `ownerSub` is the job creator's and a listed booker
   * would otherwise be unable to undo their own reservation. Note this is
   * independent of the SOW state and of the lab's pause — a paused job's existing
   * bookings must still be cancellable, which is what "it never touches existing
   * bookings" means.
   */
  async assertMayCancel(booking: any, user: User): Promise<void> {
    const actor = this.actorFor(user);
    if (actor.hasJobsViewAll || hasPermission(user, Permission.InventoryWrite)) return;
    if (booking.createdBySub && actor.sub && booking.createdBySub === actor.sub) return;

    const job: any = await this.jobService.findById(String(booking.jobId));
    if (!job) throw new ForbiddenException('You are not authorized to cancel this booking.');
    if (job.sub && actor.sub && job.sub === actor.sub) return;
    if (matchesClientEmail(job.clientEmail, actor.email)) return;

    const operations = await this.loadOperations(job);
    const operation = operations.find((op) => op.nodeId === String(booking.nodeId));
    const [actorEmail] = normalizeBookerEmails(actor.email);
    if (operation && actorEmail && operation.bookers.includes(actorEmail)) return;

    throw new ForbiddenException('You are not authorized to cancel this booking.');
  }
}
