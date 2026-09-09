import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingBillingStatus, BookingDocument, BookingKind, BookingStatus } from './booking.model';
import { CreateBookingInput } from './dtos/create-booking.input';
import { InventoryService } from '../inventory/inventory.service';
import { AvailabilityService } from '../availability/availability.service';
import { KeycloakService } from '../keycloak/keycloak.service';
import { resolveCategoryPrice } from '../pricing/service-pricing.util';
import { CustomerCategory } from '../pricing/customer-category';

interface ActorIdentity {
  sub?: string;
  email?: string;
  name?: string;
  /** The caller's own token claims, so their category resolves without an API call. */
  realm_access?: { roles?: string[] };
  groups?: string[];
}

interface BookingFilter {
  from?: Date;
  to?: Date;
  inventoryItemId?: string;
  status?: BookingStatus;
  ownerSub?: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * The Mongo filter for "touches this window": a timed slot that OVERLAPS it, or a
 * consumable whose usedOn falls inside it.
 *
 * It used to match timed slots by start time alone, so a reservation that began
 * before the window and ran through it — a multi-day hold — was missing from the
 * schedule, the availability board and every week but its first.
 */
export function windowFilter(from?: Date | string, to?: Date | string): Record<string, unknown> {
  if (!from && !to) return {};
  const timed: Record<string, unknown> = {};
  const usedOn: Record<string, unknown> = {};
  if (to) {
    timed.startTime = { $lte: new Date(to) };
    usedOn.$lte = new Date(to);
  }
  if (from) {
    timed.endTime = { $gte: new Date(from) };
    usedOn.$gte = new Date(from);
  }
  return { $or: [timed, { usedOn }] };
}

@Injectable()
export class BookingService {
  constructor(
    @InjectModel(Booking.name) private readonly model: Model<BookingDocument>,
    private readonly inventoryService: InventoryService,
    private readonly availability: AvailabilityService,
    private readonly keycloakService: KeycloakService
  ) {}

  /**
   * Which pricing category this booking is billed at.
   *
   * The **owner's**, never the requester's — staff may book on someone else's
   * behalf, and pricing a colleague's booking at staff rates is the same mistake
   * `AddNodeInputPipe` makes with `node.price`. When the two are the same person
   * (the ordinary case) the caller's own token claims answer it with no round trip;
   * only an owner override reaches the Keycloak Admin API.
   *
   * Returns undefined rather than throwing when nothing resolves. A booking must
   * not fail because Keycloak is unreachable — `UsageBillingService.generateBilling`
   * refuses an unrated booking at billing time instead, where there is a person to
   * read the message and an owner to give a pricing group to.
   */
  private async resolveOwnerCategory(input: CreateBookingInput, ownerSub: string, actor: ActorIdentity): Promise<CustomerCategory | undefined> {
    if (input.customerCategory) return input.customerCategory as CustomerCategory;
    const bookingForSelf = !!actor.sub && actor.sub === ownerSub;
    return this.keycloakService.resolveCustomerCategoryForUser(bookingForSelf ? { sub: actor.sub, realm_access: actor.realm_access, groups: actor.groups } : { sub: ownerSub });
  }

  /** Timed (hourly machine) vs quantity (per-unit consumable). */
  private inferKind(item: any): BookingKind {
    if (item.rateType === 'PER_UNIT') return BookingKind.QUANTITY;
    if (item.rateType === 'HOURLY') return BookingKind.TIMED;
    return item.type === 'CONSUMABLE' ? BookingKind.QUANTITY : BookingKind.TIMED;
  }

  /**
   * Parse and validate a booking's time window — the same exception/message
   * every caller relied on before this was pulled out. Kept separate from the
   * availability check below so each method can place the item guards (deleted/
   * bookable) between the two, matching each method's own pre-existing order.
   */
  private assertValidWindow(startTime: Date | string | number | null | undefined, endTime: Date | string | number | null | undefined): { start: Date; end: Date } {
    const start = startTime ? new Date(startTime) : null;
    const end = endTime ? new Date(endTime) : null;
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Start and end time are required to book this item.');
    }
    if (end.getTime() <= start.getTime()) throw new BadRequestException('End time must be after start time.');
    return { start, end };
  }

  /**
   * Check the shared availability pool for conflicts on a validated window —
   * walk-up bookings, lab-monitor operation holds and other jobs' bookings all
   * conflict here. `excludeBookingId` lets a booking being moved ignore its own
   * current slot.
   */
  private async assertAvailable(itemId: string, start: Date, end: Date, excludeBookingId?: string): Promise<void> {
    const conflicts = await this.availability.findItemConflicts({ itemIds: [itemId], start, end, excludeBookingId });
    if (conflicts.length > 0) {
      throw new BadRequestException(`That item is unavailable for the selected time (${conflicts.map((c) => c.label).join('; ')}).`);
    }
  }

  async create(input: CreateBookingInput, actor: ActorIdentity): Promise<Booking> {
    const item: any = await this.inventoryService.find(input.inventoryItemId);
    if (!item) throw new NotFoundException('Inventory item not found.');
    if (item.isDeleted) throw new BadRequestException('That inventory item is no longer available.');
    if (!item.bookable) throw new BadRequestException('That inventory item is not bookable.');

    const kind = this.inferKind(item);
    const ownerSub = input.ownerSub || actor.sub || '';
    const ownerEmail = input.ownerEmail || actor.email || '';
    if (!ownerSub || !ownerEmail) throw new BadRequestException('Booking owner could not be determined.');
    const customerCategory = await this.resolveOwnerCategory(input, ownerSub, actor);
    // THE pricing chain, shared with services and the SOW. `resolveRate` used to be
    // a second copy of it that differed in exactly two ways for an uncategorised
    // caller: it fell through to the *internal* tier — the leak `pricing-visibility`
    // exists to prevent — and `Number(null)` is 0, so a null price became a free
    // booking. Resolving the category above is what keeps that fall-through rare.
    const rate = resolveCategoryPrice(item, customerCategory);

    const base: any = {
      inventoryItem: item.id,
      inventoryName: item.name,
      inventoryType: item.type,
      ownerSub,
      ownerEmail,
      ownerName: input.ownerName || (input.ownerSub ? undefined : actor.name),
      ownerInstitution: input.ownerInstitution,
      customerCategory,
      createdBySub: actor.sub,
      createdByName: actor.name,
      kind,
      status: BookingStatus.RESERVED,
      billingStatus: BookingBillingStatus.UNBILLED,
      rateSnapshot: rate ?? undefined,
      notes: input.notes
    };

    if (kind === BookingKind.TIMED) {
      const { start, end } = this.assertValidWindow(input.startTime, input.endTime);
      await this.assertAvailable(item.id, start, end);

      base.startTime = start;
      base.endTime = end;
      const hours = (end.getTime() - start.getTime()) / 3_600_000;
      base.cost = rate != null ? round2(hours * rate) : undefined;
    } else {
      const qty = input.quantity ?? 1;
      if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException('Quantity must be a positive number.');
      base.quantity = qty;
      base.usedOn = input.usedOn ? new Date(input.usedOn) : new Date();
      base.cost = rate != null ? round2(qty * rate) : undefined;
    }

    return this.model.create(base);
  }

  /**
   * A booking made from a job page against one of its equipment-use operations.
   *
   * Separate from `create` rather than a branch inside it, because almost every
   * input differs: the owner is the JOB (the billed party), never the actor; the
   * rate is the OPERATION's per-category service price, never the item's hourly
   * rate; and the notes default names the job. What it shares — the availability
   * pool and the cost arithmetic — it shares by calling the same collaborators.
   */
  async createForJob(params: { job: any; nodeId: string; nodeLabel: string; service: any; item: any; startTime: Date; endTime: Date; notes?: string; actor: ActorIdentity }): Promise<Booking> {
    const { job, item, service, actor } = params;
    const { start, end } = this.assertValidWindow(params.startTime, params.endTime);
    if (item.isDeleted) throw new BadRequestException('That inventory item is no longer available.');
    if (!item.bookable) throw new BadRequestException('That inventory item is not bookable.');
    await this.assertAvailable(String(item.id), start, end);

    const rate = resolveCategoryPrice(service, job.customerCategory as CustomerCategory | undefined);
    const hours = (end.getTime() - start.getTime()) / 3_600_000;
    // Legacy jobs carry no display id; the database id is still a stable handle.
    const jobDisplayId = job.jobId || String(job._id);

    return this.model.create({
      inventoryItem: item.id,
      inventoryName: item.name,
      inventoryType: item.type,
      ownerSub: job.sub,
      ownerEmail: job.email,
      ownerName: job.clientDisplayName || job.username,
      ownerInstitution: job.institute,
      customerCategory: job.customerCategory,
      createdBySub: actor.sub,
      createdByName: actor.name,
      jobId: String(job._id),
      nodeId: params.nodeId,
      serviceId: String(service._id ?? service.id),
      kind: BookingKind.TIMED,
      status: BookingStatus.RESERVED,
      billingStatus: BookingBillingStatus.UNBILLED,
      startTime: start,
      endTime: end,
      rateSnapshot: rate ?? undefined,
      cost: rate != null ? round2(hours * rate) : undefined,
      notes: params.notes?.trim() || `Job #${jobDisplayId} · ${params.nodeLabel}`
    });
  }

  /**
   * Move or re-note a job-scoped booking. Walk-up bookings are deliberately not
   * reachable here — they keep their cancel-and-rebook flow until someone decides
   * otherwise.
   */
  async updateForJob(id: string, changes: { startTime: Date; endTime: Date; notes?: string }): Promise<Booking> {
    const existing = await this.model.findById(id).exec();
    if (!existing) throw new NotFoundException('Booking not found.');
    if (!existing.jobId) throw new BadRequestException('That booking is not attached to a job.');
    if (existing.billingStatus === BookingBillingStatus.BILLED) throw new BadRequestException('Cannot change a booking that has already been billed.');

    const { start, end } = this.assertValidWindow(changes.startTime, changes.endTime);
    await this.assertAvailable(String(existing.inventoryItem), start, end, id);

    const hours = (end.getTime() - start.getTime()) / 3_600_000;
    const set: Record<string, unknown> = {
      startTime: start,
      endTime: end,
      cost: existing.rateSnapshot != null ? round2(hours * existing.rateSnapshot) : existing.cost
    };
    const notes = changes.notes?.trim();
    if (notes) set.notes = notes;

    return (await this.model.findByIdAndUpdate(id, { $set: set }, { new: true }).exec())!;
  }

  /** Confirm actual usage (seeded from the booking) and recompute cost. Required before billing. */
  async confirmUsage(id: string, actualHours: number | null, actualQuantity: number | null, by?: string): Promise<Booking> {
    const b = await this.model.findById(id).exec();
    if (!b) throw new NotFoundException('Booking not found.');
    if (b.status === BookingStatus.CANCELLED) throw new BadRequestException('Cannot confirm usage on a cancelled booking.');

    const rate = b.rateSnapshot;
    const update: Record<string, unknown> = {
      usageConfirmed: true,
      usageConfirmedBy: by,
      usageConfirmedAt: new Date(),
      status: BookingStatus.COMPLETED
    };

    if (b.kind === BookingKind.TIMED) {
      const hours = actualHours != null ? actualHours : b.startTime && b.endTime ? (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 3_600_000 : 0;
      if (hours < 0) throw new BadRequestException('Hours cannot be negative.');
      update.actualHours = round2(hours);
      update.cost = rate != null ? round2(hours * rate) : b.cost;
    } else {
      const qty = actualQuantity != null ? actualQuantity : b.quantity ?? 0;
      if (qty < 0) throw new BadRequestException('Quantity cannot be negative.');
      update.actualQuantity = qty;
      update.cost = rate != null ? round2(qty * rate) : b.cost;
    }

    return (await this.model.findByIdAndUpdate(id, { $set: update }, { new: true }).exec())!;
  }

  async cancel(id: string): Promise<Booking> {
    const b = await this.model.findById(id).exec();
    if (!b) throw new NotFoundException('Booking not found.');
    if (b.billingStatus === BookingBillingStatus.BILLED) throw new BadRequestException('Cannot cancel a booking that has already been billed.');
    return (await this.model.findByIdAndUpdate(id, { $set: { status: BookingStatus.CANCELLED } }, { new: true }).exec())!;
  }

  async findById(id: string): Promise<Booking | null> {
    return this.model.findById(id).exec();
  }

  async findByOwner(ownerSub: string): Promise<Booking[]> {
    return this.model.find({ ownerSub }).sort({ startTime: -1, usedOn: -1, createdAt: -1 }).exec();
  }

  /** A job's live bookings — cancelled ones are history, not schedule. */
  async findByJob(jobId: string): Promise<Booking[]> {
    return this.model
      .find({ jobId, status: { $ne: BookingStatus.CANCELLED } })
      .sort({ startTime: 1 })
      .exec();
  }

  async findAll(filter: BookingFilter = {}): Promise<Booking[]> {
    const q: Record<string, unknown> = {};
    if (filter.inventoryItemId) q.inventoryItem = filter.inventoryItemId;
    if (filter.status) q.status = filter.status;
    if (filter.ownerSub) q.ownerSub = filter.ownerSub;
    Object.assign(q, windowFilter(filter.from, filter.to));
    return this.model.find(q).sort({ startTime: 1, usedOn: 1 }).exec();
  }

  /** Confirmed-but-unbilled usage for one owner — the candidates for a usage SOW/invoice. */
  async findBillableForOwner(ownerSub: string): Promise<Booking[]> {
    return this.model
      .find({ ownerSub, billingStatus: BookingBillingStatus.UNBILLED, usageConfirmed: true, status: { $ne: BookingStatus.CANCELLED } })
      .sort({ startTime: 1, usedOn: 1 })
      .exec();
  }

  async getByIds(ids: string[]): Promise<Booking[]> {
    return this.model.find({ _id: { $in: ids } }).exec();
  }

  /** Distinct owners who have confirmed, unbilled usage — powers the staff "pick a user to bill" list. */
  async getBillableOwners(): Promise<Array<{ ownerSub: string; ownerEmail: string; ownerName?: string; bookingCount: number; totalCost: number }>> {
    const rows = await this.model.aggregate([
      { $match: { billingStatus: BookingBillingStatus.UNBILLED, usageConfirmed: true, status: { $ne: BookingStatus.CANCELLED } } },
      {
        $group: {
          _id: '$ownerSub',
          ownerEmail: { $first: '$ownerEmail' },
          ownerName: { $first: '$ownerName' },
          bookingCount: { $sum: 1 },
          totalCost: { $sum: { $ifNull: ['$cost', 0] } }
        }
      },
      { $sort: { ownerName: 1, ownerEmail: 1 } }
    ]);
    return rows.map((r: any) => ({
      ownerSub: String(r._id),
      ownerEmail: r.ownerEmail,
      ownerName: r.ownerName,
      bookingCount: r.bookingCount,
      totalCost: round2(r.totalCost || 0)
    }));
  }

  async markBilled(ids: string[], sowId?: string, invoiceId?: string): Promise<void> {
    const set: Record<string, unknown> = { billingStatus: BookingBillingStatus.BILLED };
    if (sowId) set.billedSowId = sowId;
    if (invoiceId) set.billedInvoiceId = invoiceId;
    await this.model.updateMany({ _id: { $in: ids } }, { $set: set }).exec();
  }
}
