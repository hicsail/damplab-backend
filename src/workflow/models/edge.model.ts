import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { WorkflowNode } from './node.model';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';

/**
 * Represents a single edge in a workflow. An edge is a connection between
 * two nodes.
 *
 * NOTE: This will be further expanded on in the future
 */
@Schema()
@ObjectType({ description: 'Represents a single edge in a workflow' })
export class WorkflowEdge {
  @Field(() => ID, { description: 'unique database generated ID' })
  _id: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: WorkflowNode.name })
  @Field(() => WorkflowNode, { description: 'The source node of the edge' })
  source: mongoose.Types.ObjectId | WorkflowNode;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: WorkflowNode.name })
  @Field(() => WorkflowNode, { description: 'The target node of the edge' })
  destination: mongoose.Types.ObjectId | WorkflowNode;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  @Field(() => JSON, { description: 'React Flow representation of the graph for re-generating' })
  reactEdge: any;
}

export type WorkflowEdgeDocument = WorkflowEdge & Document;
export const WorkflowEdgeSchema = SchemaFactory.createForClass(WorkflowEdge);
