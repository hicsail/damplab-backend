import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { DampLabService } from '../../services/models/damplab-service.model';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';

/**
 * Represents a single node in a workflow. A node is a service with the
 * cooresponding parameters populated.
 */
@Schema()
@ObjectType({ description: 'Represents a single node in a workflow. A node is a service with the cooresponding parameters populated.' })
export class WorkflowNode {
  /** Database generated ID */
  _id: string;

  @Field(() => ID, { description: 'ID used in identify the node in the workflow' })
  @Prop({ required: true })
  id: string;

  @Prop()
  @Field({ description: 'Human readable name of the service' })
  label: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowNode' })
  @Field(() => DampLabService, { description: 'The service this node represents' })
  service: mongoose.Types.ObjectId | DampLabService;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  @Field(() => JSON, { description: 'Parameters that are part of the service' })
  parameters: any;

  @Prop()
  @Field({ description: 'Additional instructions for this portion of the workflow' })
  additionalInstructions: string;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  @Field(() => JSON, { description: 'Parameters defined earlier in the graph' })
  formData: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  @Field(() => JSON, { description: 'React Flow representation of the graph for re-generating' })
  reactNode: JSON;
}

export type WorkflowNodeDocument = WorkflowNode & Document;
export const WorkflowNodeSchema = SchemaFactory.createForClass(WorkflowNode);
