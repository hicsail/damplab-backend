import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import { WorkflowNode, WorkflowNodeDocument, WorkflowNodeState } from '../workflow/models/node.model';
import { Booking, BookingDocument } from '../booking/booking.model';

/** A single inventory-availability conflict (shared pool: operations + calendar bookings). */
@ObjectType({ description: 'An inventory item that is unavailable for a given window, and why.' })
export class InventoryConflict {
  @Field(() => ID)
  itemId: string;

  @Field({ description: 'OPERATION (held by a workflow node) or BOOKING (calendar reservation).' })
  source: 'OPERATION' | 'BOOKING';

  @Field({ description: 'Human-readable reason, e.g. "held by op X (job #04217)" or "booked by Jane Doe".' })
  label: string;

  @Field({ nullable: true })
  start?: Date;

  @Field({ nullable: true })
  end?: Date;
}

interface ConflictQuery {
  itemIds?: string[];
  start?: Date | null;
  end?: Date | null;
  excludeNodeId?: string;
  excludeBookingId?: string;
}

const DEFAULT_HOLD_MIN = 240; // a windowless/derived hold occupies ~4h by default
const overlaps = (aS: Date, aE: Date, bS: Date, bE: Date): boolean => aS < bE && bS < aE;

/**
 * Single source of truth for "is this inventory item free in this window?" across
 * BOTH worlds: operations holding inventory (WorkflowNode.usedInventory) and timed
 * calendar bookings. Used by the Lab Monitor picker and by booking creation, so the
 * two share one availability pool (bidirectional conflict prevention).
 *
 * Consumable (QUANTITY) bookings do NOT lock a machine and are ignored here.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    @InjectModel(WorkflowNode.name) private readonly nodeModel: Model<WorkflowNodeDocument>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>
  ) {}

  /** Effective [start,end] window an operation's inventory hold occupies. */
  private nodeWindow(n: any): [Date, Date] {
    const s = n.inventoryReservationStart
      ? new Date(n.inventoryReservationStart)
      : n.startedAt
        ? new Date(n.startedAt)
        : new Date();
    const e = n.inventoryReservationEnd
      ? new Date(n.inventoryReservationEnd)
      : new Date(s.getTime() + (n.estimatedMinutes || DEFAULT_HOLD_MIN) * 60000);
    return [s, e];
  }

  async findItemConflicts(q: ConflictQuery): Promise<InventoryConflict[]> {
    const ids = (q.itemIds ?? []).map(String).filter(Boolean);
    const oids = ids.map((id) => new mongoose.Types.ObjectId(id));
    const reqStart = q.start ? new Date(q.start) : new Date();
    const reqEnd = q.end ? new Date(q.end) : new Date(reqStart.getTime() + DEFAULT_HOLD_MIN * 60000);
    const conflicts: InventoryConflict[] = [];

    // --- Operation holds ---
    const nodeFilter: any = { usedInventory: ids.length ? { $in: oids } : { $exists: true, $ne: [] } };
    if (q.excludeNodeId) nodeFilter._id = { $ne: q.excludeNodeId };
    const nodes = await this.nodeModel
      .find(nodeFilter)
      .select('_id label usedInventory state startedAt estimatedMinutes inventoryReservationStart inventoryReservationEnd')
      .lean()
      .exec();
    for (const n of nodes as any[]) {
      const hasWindow = !!(n.inventoryReservationStart || n.inventoryReservationEnd);
      // A node "holds" inventory if it's IN_PROGRESS, or has an explicit (possibly future) reservation window.
      if (n.state !== WorkflowNodeState.IN_PROGRESS && !hasWindow) continue;
      const [ns, ne] = this.nodeWindow(n);
      if (!overlaps(reqStart, reqEnd, ns, ne)) continue;
      for (const inv of (n.usedInventory ?? []) as mongoose.Types.ObjectId[]) {
        if (ids.length && !oids.some((o) => o.equals(inv))) continue;
        conflicts.push({ itemId: String(inv), source: 'OPERATION', label: `held by operation "${n.label || 'operation'}"`, start: ns, end: ne });
      }
    }

    // --- Timed calendar bookings ---
    const bookingFilter: any = {
      kind: 'TIMED',
      status: { $in: ['RESERVED', 'IN_USE'] },
      startTime: { $lt: reqEnd },
      endTime: { $gt: reqStart }
    };
    if (ids.length) bookingFilter.inventoryItem = { $in: oids };
    if (q.excludeBookingId) bookingFilter._id = { $ne: q.excludeBookingId };
    const bookings = await this.bookingModel
      .find(bookingFilter)
      .select('_id inventoryItem inventoryName startTime endTime ownerName ownerEmail')
      .lean()
      .exec();
    for (const b of bookings as any[]) {
      conflicts.push({
        itemId: String(b.inventoryItem),
        source: 'BOOKING',
        label: `booked by ${b.ownerName || b.ownerEmail || 'a user'}`,
        start: b.startTime,
        end: b.endTime
      });
    }

    return conflicts;
  }
}
