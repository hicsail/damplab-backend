import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { Workflow } from '../workflow/models/workflow.model';

export enum JobState {
  CREATING,
  SUBMITTED,
  ACCEPTED,
  WAITING_FOR_SOW,
  QUEUED,
  IN_PROGRESS,
  COMPLETE,
  REJECTED
}
registerEnumType(JobState, { name: 'JobState' });

@Schema()
@ObjectType({ description: 'Jobs encapsulate many workflows that were submitted together' })
export class Job {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop()
  @Field({ description: 'Human readable name of the workflow' })
  name: string;

  /// These fields will be replaced by a user field in the future /////////////
  @Prop()
  @Field({ description: 'Username of the person who submitted the job' })
  username: string;

  @Prop()
  @Field({ description: 'The institute the user is from' })
  institute: string;

  @Prop()
  @Field({ description: 'The email address of the user' })
  email: string;
  /////////////////////////////////////////////////////////////////////////////

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: Workflow.name }] })
  @Field(() => [Workflow], { description: 'The workflows that were submitted together' })
  workflows: mongoose.Types.ObjectId[];

  @Prop({ default: new Date() })
  @Field({ description: 'The date the job was submitted' })
  submitted: Date;

  @Prop({ required: false })
  @Field({ description: 'Additional information the user provided', nullable: true })
  notes?: string;

  @Prop({ required: true, default: JobState.CREATING })
  @Field(() => JobState, { description: 'Where in the Job life cycle this Job is' })
  state: JobState;
}

export type JobDocument = Job & Document;
export const JobSchema = SchemaFactory.createForClass(Job);
