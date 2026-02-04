import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { DampLabService } from '../../services/models/damplab-service.model';
import { Field, ID, ObjectType, registerEnumType, Float } from '@nestjs/graphql';
import JSON from 'graphql-type-json';

export enum WorkflowNodeState {
  QUEUED,
  IN_PROGRESS,
  COMPLETE
}
registerEnumType(WorkflowNodeState, { name: 'WorkflowNodeState' });

/**
 * Represents a single node in a workflow. A node is a service with the
 * cooresponding parameters populated.
 */
@Schema()
@ObjectType({ description: 'Represents a single node in a workflow. A node is a service with the cooresponding parameters populated.' })
export class WorkflowNode {
  /** Database generated ID */
  @Field(() => ID, { description: 'Database generated ID', name: '_id' })
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

  @Prop()
  @Field({ description: 'Additional instructions for this portion of the workflow' })
  additionalInstructions: string;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  @Field(() => JSON, {
    description:
      'Parameters defined earlier in the graph. Always returned as an array of { id, value }; multi-value params have value: string[]. Stored in array shape for new/updated nodes.'
  })
  formData: any;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  @Field(() => JSON, { description: 'React Flow representation of the graph for re-generating' })
  reactNode: JSON;

  @Prop({ requied: true, default: WorkflowNodeState.QUEUED })
  @Field(() => WorkflowNodeState, { description: 'Where in the process is the current node' })
  state: WorkflowNodeState;

  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'Snapshot of service price at submission time' })
  price?: number;
}

export type WorkflowNodeDocument = WorkflowNode & Document;
export const WorkflowNodeSchema = SchemaFactory.createForClass(WorkflowNode);
