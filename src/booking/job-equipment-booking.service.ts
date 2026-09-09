import { Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
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
}
