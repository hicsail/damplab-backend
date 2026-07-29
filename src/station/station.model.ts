import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Field, ID, ObjectType, Int, Float } from '@nestjs/graphql';

/**
 * A physical location in the lab where equipment lives and steps are executed.
 * The structured source of truth for "where" — replacing the free-text
 * InventoryItem.location annotation for scheduling / movement simulation.
 */
@Schema({ timestamps: true })
@ObjectType({ description: 'A physical station/location in the lab.' })
export class Station {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ required: true })
  @Field({ description: 'Human-readable station name (e.g. "Bench 3", "PCR Corner").' })
  name: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Station type/category (e.g. "bench", "instrument", "fume hood").' })
  type?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Lab zone/room the station belongs to.' })
  zone?: string;

  @Prop({ required: false })
  @Field(() => Int, { nullable: true, description: 'How many concurrent operations the station supports.' })
  capacity?: number;

  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'X coordinate on the lab layout (for movement simulation).' })
  x?: number;

  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'Y coordinate on the lab layout.' })
  y?: number;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Free-text notes.' })
  notes?: string;

  @Prop({ required: false, default: false })
  @Field(() => Boolean, { nullable: true, defaultValue: false, description: 'Soft-deleted flag.' })
  isDeleted?: boolean;
}

export type StationDocument = Station & Document;
export const StationSchema = SchemaFactory.createForClass(Station);
