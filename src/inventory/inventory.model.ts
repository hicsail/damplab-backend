import { ObjectType, Field, ID, Int, registerEnumType } from '@nestjs/graphql';
import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';

/**
 * Coarse category for filtering and grouping on the availability board.
 * Open-ended on purpose — extend as the lab adds new categories of gear.
 */
export enum InventoryItemType {
  ROBOT = 'ROBOT',
  MACHINE = 'MACHINE',
  INSTRUMENT = 'INSTRUMENT',
  CONSUMABLE = 'CONSUMABLE',
  OTHER = 'OTHER'
}
registerEnumType(InventoryItemType, { name: 'InventoryItemType' });

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

  @Prop({ required: false, default: InventoryItemType.MACHINE, type: String, enum: Object.values(InventoryItemType) })
  @Field(() => InventoryItemType, {
    nullable: true,
    defaultValue: InventoryItemType.MACHINE,
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
    description: 'Soft-deleted: hidden from pickers but still resolvable for historical nodes.'
  })
  isDeleted?: boolean;
}

export type InventoryItemDocument = InventoryItem & mongoose.Document;
export const InventoryItemSchema = SchemaFactory.createForClass(InventoryItem);
