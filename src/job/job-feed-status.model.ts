import { Field, ObjectType } from '@nestjs/graphql';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';

@Schema({ collection: 'job_feed_status' })
export class JobFeedStatusEntity {
  @Prop({ required: true, unique: true, default: 'global' })
  key: string;

  @Prop({ type: Date, required: false })
  viewedAt?: Date;
}

export type JobFeedStatusEntityDocument = JobFeedStatusEntity & mongoose.Document;
export const JobFeedStatusEntitySchema = SchemaFactory.createForClass(JobFeedStatusEntity);

@ObjectType()
export class JobFeedStatus {
  @Field(() => Date, { nullable: true })
  viewedAt: Date | null;

  @Field(() => Date, { nullable: true })
  latestSubmittedAt: Date | null;

  @Field(() => Boolean)
  hasUnseen: boolean;
}
