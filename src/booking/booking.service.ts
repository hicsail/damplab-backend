import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Booking, BookingBillingStatus, BookingDocument, BookingKind, BookingStatus } from './booking.model';
import { CreateBookingInput } from './dtos/create-booking.input';
import { InventoryService } from '../inventory/inventory.service';
import { InventoryItemType } from '../inventory/inventory.model';
import { AvailabilityService } from '../availability/availability.service';

interface ActorIdentity {
  sub?: string;
  email?: string;
  name?: string;
}

interface BookingFilter {
  from?: Date;
  to?: Date;
  inventoryItemId?: string;
  status?: BookingStatus;
  ownerSub?: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class BookingService {
  constructor(
    @InjectModel(Booking.name) private readonly model: Model<BookingDocument>,
    private readonly inventoryService: InventoryService,
    private readonly availability: AvailabilityService
  ) {}

  /** Resolve the $/hour or $/unit rate for a customer category from a Pricing object. */
  private resolveRate(pricing: any, category?: string): number | undefined {
    if (!pricing || typeof pricing !== 'object') return undefined;
    const num = (v: unknown): number | undefined => {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    switch (category) {
      case 'INTERNAL_CUSTOMERS':
        return num(pricing.internal) ?? num(pricing.legacy);
      case 'EXTERNAL_CUSTOMER_ACADEMIC':
        return num(pricing.externalAcademic) ?? num(pricing.external) ?? num(pricing.legacy);
      case 'EXTERNAL_CUSTOMER_MARKET':
        return num(pricing.externalMarket) ?? num(pricing.external) ?? num(pricing.legacy);
      case 'EXTERNAL_CUSTOMER_NO_SALARY':
        return num(pricing.externalNoSalary) ?? num(pricing.external) ?? num(pricing.legacy);
      default:
        return num(pricing.legacy) ?? num(pricing.internal) ?? num(pricing.external);
    }
  }

  /** Timed (hourly machine) vs quantity (per-unit consumable). */
  private inferKind(item: any): BookingKind {
    if (item.rateType === 'PER_UNIT') return BookingKind.QUANTITY;
    if (item.rateType === 'HOURLY') return BookingKind.TIMED;
    return item.type === InventoryItemType.CONSUMABLE ? BookingKind.QUANTITY : BookingKind.TIMED;
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
    const customerCategory = input.customerCategory || undefined;
    const rate = this.resolveRate(item.pricing, customerCategory);

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
      const start = input.startTime ? new Date(input.startTime) : null;
      const end = input.endTime ? new Date(input.endTime) : null;
      if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new BadRequestException('Start and end time are required to book this item.');
      }
      if (end.getTime() <= start.getTime()) throw new BadRequestException('End time must be after start time.');

      // Shared availability pool: conflicts with other bookings AND with operation holds.
      const conflicts = await this.availability.findItemConflicts({ itemIds: [item.id], start, end });
      if (conflicts.length > 0) {
        const detail = conflicts.map((c) => c.label).join('; ');
        throw new BadRequestException(`That item is unavailable for the selected time (${detail}).`);
      }

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
      const hours =
        actualHours != null
          ? actualHours
          : b.startTime && b.endTime
            ? (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 3_600_000
            : 0;
      if (hours < 0) throw new BadRequestException('Hours cannot be negative.');
      update.actualHours = round2(hours);
      update.cost = rate != null ? round2(hours * rate) : b.cost;
    } else {
      const qty = actualQuantity != null ? actualQuantity : (b.quantity ?? 0);
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

  async findAll(filter: BookingFilter = {}): Promise<Booking[]> {
    const q: Record<string, unknown> = {};
    if (filter.inventoryItemId) q.inventoryItem = filter.inventoryItemId;
    if (filter.status) q.status = filter.status;
    if (filter.ownerSub) q.ownerSub = filter.ownerSub;
    // Date-range overlap on either the timed slot or the consumable usedOn date.
    if (filter.from || filter.to) {
      const range: any = {};
      if (filter.from) range.$gte = new Date(filter.from);
      if (filter.to) range.$lte = new Date(filter.to);
      q.$or = [{ startTime: range }, { usedOn: range }];
    }
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
