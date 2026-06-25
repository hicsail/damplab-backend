import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';
import { Field, ID, ObjectType, Float, Int, registerEnumType } from '@nestjs/graphql';
import { InventoryItem, InventoryItemType } from '../inventory/inventory.model';

/** Timed (machine, by the hour) vs quantity (consumable, by the unit). */
export enum BookingKind {
  TIMED = 'TIMED',
  QUANTITY = 'QUANTITY'
}
registerEnumType(BookingKind, { name: 'BookingKind' });

export enum BookingStatus {
  RESERVED = 'RESERVED',
  IN_USE = 'IN_USE',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}
registerEnumType(BookingStatus, { name: 'BookingStatus' });

export enum BookingBillingStatus {
  UNBILLED = 'UNBILLED',
  BILLED = 'BILLED'
}
registerEnumType(BookingBillingStatus, { name: 'BookingBillingStatus' });

/**
 * A reservation/usage record for a bookable inventory item. Machines are booked
 * for a time slot (kind=TIMED, billed by the hour); consumables are booked by
 * quantity (kind=QUANTITY, billed per unit). Cost is derived from CONFIRMED
 * usage (which is seeded from the booking) × the rate snapshot, and stays
 * UNBILLED until staff roll it into a usage SOW/invoice.
 */
@Schema({ timestamps: true })
@ObjectType({ description: 'A booking/usage record for a bookable inventory item (timed machine or quantity consumable).' })
export class Booking {
  @Field(() => ID, { name: '_id', description: 'Database generated id' })
  _id: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: InventoryItem.name, required: true })
  @Field(() => ID, { description: 'The booked inventory item.' })
  inventoryItem: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Snapshot of the item name at booking time.' })
  inventoryName?: string;

  @Prop({ required: false, type: String, enum: Object.values(InventoryItemType) })
  @Field(() => InventoryItemType, { nullable: true, description: 'Snapshot of the item type.' })
  inventoryType?: InventoryItemType;

  // --- Owner: who the booking is for and who gets billed ---
  @Prop({ required: true })
  @Field({ description: 'Keycloak sub of the user the booking is for (billed party).' })
  ownerSub: string;

  @Prop({ required: true })
  @Field({ description: 'Email of the owner.' })
  ownerEmail: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Display name of the owner.' })
  ownerName?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Owner institution (for SOW/invoice).' })
  ownerInstitution?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Customer category snapshot, used to resolve the rate.' })
  customerCategory?: string;

  // --- Creator (self or staff) ---
  @Prop({ required: false })
  @Field({ nullable: true, description: 'Keycloak sub of whoever created the booking.' })
  createdBySub?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Display name of whoever created the booking.' })
  createdByName?: string;

  @Prop({ required: true, type: String, enum: Object.values(BookingKind) })
  @Field(() => BookingKind, { description: 'TIMED (machine, hourly) or QUANTITY (consumable, per-unit).' })
  kind: BookingKind;

  // --- TIMED ---
  @Prop({ required: false })
  @Field({ nullable: true, description: 'Reserved start time (TIMED).' })
  startTime?: Date;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Reserved end time (TIMED).' })
  endTime?: Date;

  // --- QUANTITY ---
  @Prop({ required: false })
  @Field(() => Int, { nullable: true, description: 'Reserved quantity (QUANTITY).' })
  quantity?: number;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Date the consumable is used (QUANTITY).' })
  usedOn?: Date;

  @Prop({ required: true, type: String, enum: Object.values(BookingStatus), default: BookingStatus.RESERVED })
  @Field(() => BookingStatus, { description: 'Lifecycle status.' })
  status: BookingStatus;

  // --- Logged usage (seeded from the booking; confirmed before billing) ---
  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'Confirmed actual hours used (TIMED).' })
  actualHours?: number;

  @Prop({ required: false })
  @Field(() => Int, { nullable: true, description: 'Confirmed actual quantity used (QUANTITY).' })
  actualQuantity?: number;

  @Prop({ required: false, default: false })
  @Field(() => Boolean, { nullable: true, defaultValue: false, description: 'Whether actual usage has been confirmed (required before billing).' })
  usageConfirmed?: boolean;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Who confirmed the usage.' })
  usageConfirmedBy?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'When usage was confirmed.' })
  usageConfirmedAt?: Date;

  // --- Billing ---
  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'Rate snapshot ($/hour or $/unit) for the owner category at booking time.' })
  rateSnapshot?: number;

  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'Computed cost = (confirmed-or-booked usage) × rate snapshot.' })
  cost?: number;

  @Prop({ required: true, type: String, enum: Object.values(BookingBillingStatus), default: BookingBillingStatus.UNBILLED })
  @Field(() => BookingBillingStatus, { description: 'Whether this usage has been rolled into a SOW/invoice.' })
  billingStatus: BookingBillingStatus;

  @Prop({ required: false })
  @Field(() => ID, { nullable: true, description: 'SOW this usage was billed under (once BILLED).' })
  billedSowId?: string;

  @Prop({ required: false })
  @Field(() => ID, { nullable: true, description: 'Invoice this usage was billed under (once BILLED).' })
  billedInvoiceId?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Free-text notes.' })
  notes?: string;
}

export type BookingDocument = Booking & Document;
export const BookingSchema = SchemaFactory.createForClass(Booking);

BookingSchema.index({ inventoryItem: 1, startTime: 1, endTime: 1 });
BookingSchema.index({ ownerSub: 1 });
BookingSchema.index({ billingStatus: 1 });
BookingSchema.index({ status: 1 });
