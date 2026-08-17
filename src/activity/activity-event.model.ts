import { Field, ID, ObjectType } from '@nestjs/graphql';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'activity_events' })
export class ActivityEventEntity {
  @Prop({ type: Date, required: true, default: () => new Date() })
  createdAt: Date;

  @Prop({ type: String, required: true })
  type: string;

  @Prop({ type: String, required: true })
  message: string;

  @Prop({ type: String, required: false })
  actorDisplayName?: string;

  @Prop({ type: String, required: false })
  jobId?: string;

  @Prop({ type: String, required: false })
  workflowId?: string;

  @Prop({ type: String, required: false })
  workflowNodeId?: string;

  @Prop({ type: String, required: false })
  serviceName?: string;
}

export type ActivityEventEntityDocument = ActivityEventEntity & Document;
export const ActivityEventEntitySchema = SchemaFactory.createForClass(ActivityEventEntity);

ActivityEventEntitySchema.index({ createdAt: -1 });
ActivityEventEntitySchema.index({ type: 1, createdAt: -1 });
ActivityEventEntitySchema.index({ jobId: 1, createdAt: -1 });

@ObjectType()
export class ActivityEvent {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => String)
  type: string;

  @Field(() => String)
  message: string;

  @Field(() => String, { nullable: true })
  actorDisplayName?: string | null;

  @Field(() => String, { nullable: true })
  jobId?: string | null;

  @Field(() => String, { nullable: true })
  workflowId?: string | null;

  @Field(() => String, { nullable: true })
  workflowNodeId?: string | null;

  @Field(() => String, { nullable: true })
  serviceName?: string | null;
}
