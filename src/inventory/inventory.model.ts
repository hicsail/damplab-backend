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

/**
 * Coarse category for filtering and grouping on the availability board.
 */
export enum InventoryItemType {
  /** @deprecated Use EQUIPMENT. Kept for backward-compatible reads until migration runs. */
  ROBOT = 'ROBOT',
  /** @deprecated Use EQUIPMENT. Kept for backward-compatible reads until migration runs. */
  MACHINE = 'MACHINE',
  /** @deprecated Use EQUIPMENT. Kept for backward-compatible reads until migration runs. */
  INSTRUMENT = 'INSTRUMENT',
  /** @deprecated Use EQUIPMENT or HOOD/STORAGE. Kept for backward-compatible reads until migration runs. */
  OTHER = 'OTHER',
  EQUIPMENT = 'EQUIPMENT',
  HOOD = 'HOOD',
  STORAGE = 'STORAGE',
  CONSUMABLE = 'CONSUMABLE'
}
registerEnumType(InventoryItemType, { name: 'InventoryItemType' });

/** A single dimension measurement (e.g. 12 cm, 5 kg). */
@ObjectType()
export class Dimension {
  @Field({ description: 'Numeric value of the measurement.' })
  value: number;

  @Field({ description: 'Unit of measurement (e.g. cm, mm, kg).' })
  unit: string;
}

@InputType()
export class DimensionInput {
  @Field()
  value: number;

  @Field()
  unit: string;
}

const DimensionSchema = new mongoose.Schema(
  {
    value: { type: Number, required: true },
    unit: { type: String, required: true }
  },
  { _id: false }
);

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

  @Prop({ required: false, default: InventoryItemType.EQUIPMENT, type: String, enum: Object.values(InventoryItemType) })
  @Field(() => InventoryItemType, {
    nullable: true,
    defaultValue: InventoryItemType.EQUIPMENT,
    description: 'Coarse category for grouping on the availability board.'
  })
  type?: InventoryItemType;

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

  @Prop({ required: false, unique: true, sparse: true })
  @Field({ nullable: true, description: 'System-generated unique identifier (e.g. INV-0001). Not the Mongo _id.' })
  uniqueId?: string;

  @Prop({ type: [String], default: [] })
  @Field(() => [String], { description: 'Filterable tags for finer categorisation (e.g. "Analytical Equipment", "Centrifuge").' })
  tags: string[];

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Manufacturer model number. Items with the same model # are the same type of equipment.' })
  modelNumber?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Serial number for tracking individual units. Internal use only — hidden from non-staff.' })
  serialNumber?: string;

  @Prop({ required: false, default: false })
  @Field(() => Boolean, { nullable: true, defaultValue: false, description: 'Whether this item has an active service contract.' })
  hasServiceContract?: boolean;

  @Prop({ required: false, type: Date })
  @Field({ nullable: true, description: 'Expiration date of the service contract, if any.' })
  serviceContractExpiration?: Date;

  @Prop({ type: [DimensionSchema], default: [] })
  @Field(() => [Dimension], { description: 'Physical dimensions of the equipment (up to 3 measurements).' })
  dimensions: Dimension[];

  @Prop({ required: false, default: false })
  @Field(() => Boolean, {
    nullable: true,
    defaultValue: false,
    description: 'Soft-deleted: hidden from pickers but still resolvable for historical nodes.'
  })
  isDeleted?: boolean;
}

export type InventoryItemDocument = InventoryItem & mongoose.Document;
export const InventoryItemSchema = SchemaFactory.createForClass(InventoryItem);
