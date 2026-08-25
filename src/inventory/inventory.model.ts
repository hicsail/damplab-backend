import { ObjectType, Field, ID, InputType, Int, registerEnumType } from '@nestjs/graphql';
import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { Pricing } from '../pricing/pricing.model';

/**
 * Where a piece of equipment physically lives, and how many are at that spot.
 * An item may be placed at several stations at once (e.g. 2 pipette sets at
 * Bench 3, 1 at PCR Corner).
 *
 * LOCATIONAL ONLY — quantity records what is where, for technician guidance and
 * the future layout view. It deliberately does NOT feed booking capacity:
 * AvailabilityService still treats one InventoryItem record as one exclusive
 * holder at a time. If concurrent holders are ever wanted, that is a change to
 * AvailabilityService, not to this field.
 */
@ObjectType({ description: 'A station this equipment is placed at, with the quantity held there.' })
export class StationPlacement {
  @Field(() => ID, { description: 'Station where these units live.' })
  stationId: string;

  @Field(() => Int, { description: 'How many units of this item are at this station.' })
  quantity: number;
}

/** Input twin of {@link StationPlacement} — GraphQL requires a distinct input type. */
@InputType()
export class StationPlacementInput {
  @Field(() => ID)
  stationId: string;

  @Field(() => Int)
  quantity: number;
}

/** Mongoose sub-schema for placements (no separate _id per entry). */
export const StationPlacementSchema = new mongoose.Schema(
  {
    stationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Station', required: true },
    quantity: { type: Number, required: true, default: 1, min: 1 }
  },
  { _id: false }
);

/** Suggested values for the type field — not enforced, users can add new ones. */
export const SUGGESTED_INVENTORY_TYPES = ['EQUIPMENT', 'HOOD', 'STORAGE', 'CONSUMABLE'];

/** How a bookable item is billed. */
export enum InventoryRateType {
  /** Machines/equipment billed per hour of usage ($/hour). */
  HOURLY = 'HOURLY',
  /** Consumables billed per unit consumed ($/unit). */
  PER_UNIT = 'PER_UNIT'
}
registerEnumType(InventoryRateType, { name: 'InventoryRateType' });

/**
 * A single piece of lab equipment that a service can be linked to and that a
 * workflow node can hold while it's in IN_PROGRESS.
 *
 * v1: one record = one physical thing. The `quantity` field is reserved for
 * future use (fungible/multi-unit items) but every record reads/writes as
 * quantity=1 for now. The lab monitor enforces exclusivity at the node level.
 */
@Schema({ timestamps: true })
@ObjectType({ description: 'A piece of lab equipment that services can require and workflow nodes can hold during IN_PROGRESS.' })
export class InventoryItem {
  @Field(() => ID, { name: 'id', description: 'unique database generated id' })
  id: string;

  @Prop({ required: true })
  @Field({ description: 'Human readable name (e.g. "OT-2 #1", "Bioanalyzer").' })
  name: string;

  @Prop({ required: false, default: 'EQUIPMENT', type: String })
  @Field(() => String, {
    nullable: true,
    defaultValue: 'EQUIPMENT',
    description: 'Coarse category for grouping on the availability board. Free string — suggested values: EQUIPMENT, HOOD, STORAGE, CONSUMABLE.'
  })
  type?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Free-text description (model, capabilities, notes).' })
  description?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Physical location in the lab.' })
  location?: string;

  @Prop({ required: false, default: 1 })
  @Field(() => Int, {
    nullable: true,
    defaultValue: 1,
    description: 'Reserved for future multi-unit support. Currently always 1.'
  })
  quantity?: number;

  @Prop({ required: false, default: false })
  @Field(() => Boolean, {
    nullable: true,
    defaultValue: false,
    description: 'Whether users can book/reserve this item. Machines book a time slot (HOURLY); consumables book a quantity (PER_UNIT).'
  })
  bookable?: boolean;

  @Prop({ required: false, type: String, enum: Object.values(InventoryRateType) })
  @Field(() => InventoryRateType, {
    nullable: true,
    description: 'How booked usage is billed: HOURLY ($/hour, time-slot) or PER_UNIT ($/unit, quantity). Defaults inferred from type when unset (CONSUMABLE → PER_UNIT, else HOURLY).'
  })
  rateType?: InventoryRateType;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  @Field(() => Pricing, {
    nullable: true,
    description: 'Booking rate by customer category, interpreted per rateType: $/hour (HOURLY) or $/unit (PER_UNIT).'
  })
  pricing?: Pricing;

  /**
   * @deprecated Superseded by {@link placements}. Kept so pre-existing documents
   * keep resolving; the service folds it into `placements` on read. Do not write.
   */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Station', required: false })
  @Field(() => ID, {
    nullable: true,
    deprecationReason: 'Use placements — equipment can be at several stations with a quantity at each.',
    description: 'Legacy single station assignment. Read via placements instead.'
  })
  stationId?: string;

  @Prop({ type: [StationPlacementSchema], default: [] })
  @Field(() => [StationPlacement], {
    description: 'Stations this equipment is placed at, with the quantity at each (equipment→station map). Locational only — does not affect booking capacity.'
  })
  placements: StationPlacement[];

  @Prop({ required: false, default: false })
  @Field(() => Boolean, {
    nullable: true,
    defaultValue: false,
    description: 'Soft-deleted: hidden from pickers but still resolvable for historical nodes.'
  })
  isDeleted?: boolean;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Username or sub of whoever last created or modified this item.' })
  lastModifiedBy?: string;
}

export type InventoryItemDocument = InventoryItem & mongoose.Document;
export const InventoryItemSchema = SchemaFactory.createForClass(InventoryItem);
