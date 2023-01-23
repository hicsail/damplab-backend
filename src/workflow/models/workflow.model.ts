import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { WorkflowNode } from './node.model';
import { WorkflowEdge } from './edge.model';
import { Field, ObjectType, registerEnumType } from '@nestjs/graphql';

/**
 * The different states the workflow can be in
 */
export enum WorkflowState {
  SUBMITTED,
  APPROVED,
  REJECTED,
  QUEUED,
  PROCESSING
}

registerEnumType(WorkflowState, { name: 'WorkflowState' });

/**
 * Represents a series of services that are connected together to form a
 * workflow.
 */
@Schema()
@ObjectType({ description: 'Represents a series of services that are connected together to form a workflow.' })
export class Workflow {
  /** Database generated ID */
  _id: string;

  @Prop()
  @Field({ description: 'Human readable name of the workflow' })
  name: string;

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: WorkflowNode.name }] })
  @Field(() => [WorkflowNode], { description: 'The nodes in the workflow' })
  nodes: mongoose.Types.ObjectId[] | WorkflowNode[];

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: WorkflowEdge.name }] })
  @Field(() => [WorkflowEdge], { description: 'The edges in the workflow' })
  edges: mongoose.Types.ObjectId[] | WorkflowEdge[];

  @Prop()
  @Field({ description: 'The name of the user who created the workflow' })
  username: string;

  @Prop()
  @Field({ description: 'The institution that the workflow belongs to' })
  institution: string;

  @Prop()
  @Field(() => WorkflowState, { description: 'Where in the process the Workflow is' })
  state: WorkflowState;
}

export type WorkflowDocument = Workflow & Document;
export const WorkflowSchema = SchemaFactory.createForClass(Workflow);
