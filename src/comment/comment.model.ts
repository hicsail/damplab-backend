import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { Job } from '../job/job.model';

export enum CommentAuthorType {
  STAFF = 'STAFF',
  CLIENT = 'CLIENT'
}
registerEnumType(CommentAuthorType, { name: 'CommentAuthorType' });

@Schema()
@ObjectType({ description: 'Comments on jobs, allowing both staff and customers to add comments and view comment history' })
export class Comment {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Job.name, required: true })
  @Field(() => ID, { description: 'ID of the job this comment belongs to' })
  jobId: string;

  @Prop({ required: true })
  @Field({ description: 'Content of the comment' })
  content: string;

  @Prop({ required: true })
  @Field({ description: 'Username or email of the person who created the comment' })
  author: string;

  @Prop({ required: true, default: CommentAuthorType.STAFF })
  @Field(() => CommentAuthorType, { description: 'Type of author (STAFF or CLIENT)' })
  authorType: CommentAuthorType;

  @Prop({ required: true, default: new Date() })
  @Field({ description: 'Date when the comment was created' })
  createdAt: Date;

  @Prop({ required: false })
  @Field({ description: 'Date when the comment was last updated', nullable: true })
  updatedAt?: Date;

  @Prop({ required: true, default: false })
  @Field({ description: 'If true, only visible to staff; if false, visible to both staff and client' })
  isInternal: boolean;

  // Legacy field for backward compatibility (kept for migration purposes)
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Job.name, required: false })
  job?: mongoose.Types.ObjectId;

  // Legacy field for backward compatibility
  @Prop({ required: false })
  message?: string;
}

export type CommentDocument = Comment & Document;
export const CommentSchema = SchemaFactory.createForClass(Comment);

// Create indexes
CommentSchema.index({ jobId: 1 });
CommentSchema.index({ createdAt: -1 });
CommentSchema.index({ authorType: 1 });
