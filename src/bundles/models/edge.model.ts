import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { BundleNode } from './node.model';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';

/**
 * Represents a single edge in a Bundle. An edge is a connection between
 * two nodes.
 *
 * NOTE: This will be further expanded on in the future
 */
@Schema()
@ObjectType({ description: 'Represents a single edge in a Bundle' })
export class BundleEdge {
  /** Database generated ID */
  _id: string;

  @Field(() => ID, { description: 'ID used in identify the edge in the Bundle' })
  @Prop({ required: true })
  id: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: BundleNode.name })
  @Field(() => BundleNode, { description: 'The source node of the edge' })
  source: mongoose.Types.ObjectId | BundleNode;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: BundleNode.name })
  @Field(() => BundleNode, { description: 'The target node of the edge' })
  target: mongoose.Types.ObjectId | BundleNode;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  @Field(() => JSON, { nullable: true, description: 'React Flow representation of the graph for re-generating' })
  reactEdge?: any;
}

export type BundleEdgeDocument = BundleEdge & Document;
export const BundleEdgeSchema = SchemaFactory.createForClass(BundleEdge);
