import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID } from '@nestjs/graphql';
import { Workflow } from '../workflow/models/workflow.model';

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
}

export type JobDocument = Job & Document;
export const JobSchema = SchemaFactory.createForClass(Job);
