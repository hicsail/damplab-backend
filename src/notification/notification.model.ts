import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'notifications', timestamps: true })
export class NotificationEntity {
  @Prop({ type: Date, required: true, default: () => new Date() })
  createdAt: Date;

  @Prop({ type: String, required: true })
  recipientSub: string;

  @Prop({ type: String, required: false })
  recipientEmail?: string;

  @Prop({ type: String, required: true })
  eventType: string;

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, required: true })
  message: string;

  @Prop({ type: String, required: false })
  link?: string;

  @Prop({ type: Date, required: false })
  readAt?: Date;

  @Prop({ type: Boolean, default: false })
  emailSent: boolean;

  @Prop({ type: Date, required: false })
  emailSentAt?: Date;

  @Prop({ type: String, required: false })
  jobId?: string;

  @Prop({ type: String, required: false })
  sowId?: string;

  @Prop({ type: String, required: false })
  actorDisplayName?: string;

  @Prop({ type: String, required: false })
  operationId?: string;
}

export type NotificationEntityDocument = NotificationEntity & Document;
export const NotificationEntitySchema = SchemaFactory.createForClass(NotificationEntity);

NotificationEntitySchema.index({ recipientSub: 1, createdAt: -1 });
NotificationEntitySchema.index({ recipientSub: 1, readAt: 1 });
NotificationEntitySchema.index({ operationId: 1 }, { unique: true, partialFilterExpression: { operationId: { $type: 'string' } } });

@ObjectType()
export class Notification {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => String)
  eventType: string;

  @Field(() => String)
  title: string;

  @Field(() => String)
  message: string;

  @Field(() => String, { nullable: true })
  link?: string | null;

  @Field(() => Date, { nullable: true })
  readAt?: Date | null;

  @Field(() => String, { nullable: true })
  jobId?: string | null;

  @Field(() => String, { nullable: true })
  sowId?: string | null;

  @Field(() => String, { nullable: true })
  actorDisplayName?: string | null;
}

@ObjectType()
export class NotificationPage {
  @Field(() => [Notification])
  items: Notification[];

  @Field(() => Int)
  unreadCount: number;
}
