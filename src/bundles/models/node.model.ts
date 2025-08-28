import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { DampLabService } from '../../services/models/damplab-service.model';
import { Field, ID, ObjectType, Float } from '@nestjs/graphql';
import JSON from 'graphql-type-json';

@ObjectType()
export class Position {
  @Field(() => Float)
  x: number;

  @Field(() => Float)
  y: number;
}

/**
 * Represents a single node in a Bundle. A node is a service with the
 * cooresponding parameters populated.
 */
@Schema()
@ObjectType({ description: 'Represents a single node in a Bundle. A node is a service with the cooresponding parameters populated.' })
export class BundleNode {
  /** Database generated ID */
  @Field(() => ID, { description: 'Database generated ID', name: '_id' })
  _id: string;

  @Prop({ required: true })
  @Field(() => ID, { description: 'ID used in identify the node in the Bundle' })
  id: string;

  @Prop()
  @Field({ description: 'Human readable name of the service' })
  label: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'BundleNode' })
  @Field(() => DampLabService, { description: 'The service this node represents' })
  service: mongoose.Types.ObjectId | DampLabService;

  @Prop()
  @Field({ nullable: true, description: 'Additional instructions for this portion of the Bundle' })
  additionalInstructions?: string;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  @Field(() => JSON, { nullable: true, description: 'Parameters defined earlier in the graph' })
  formData?: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  @Field(() => JSON, { nullable: true, description: 'React Flow representation of the graph for re-generating' })
  reactNode?: JSON;

  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'Snapshot of service price at submission time' })
  price?: number;

  @Prop({ type: Object }) 
  @Field(() => Position, { nullable: true, description: 'Position of the node in the graph' })
  position?: Position;
}

export type BundleNodeDocument = BundleNode & Document;
export const BundleNodeSchema = SchemaFactory.createForClass(BundleNode);
