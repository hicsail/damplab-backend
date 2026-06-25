import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID, Int, registerEnumType } from '@nestjs/graphql';
import { Job } from '../job/job.model';

export enum CommentAuthorType {
  STAFF = 'STAFF',
  CLIENT = 'CLIENT'
}
registerEnumType(CommentAuthorType, { name: 'CommentAuthorType' });

/**
 * File attached to a single comment. Stored as a sub-document on Comment so
 * the comment view can render the attachment inline (rather than only on the
 * job-level Attachments section, where it's decoupled from which comment
 * uploaded it). Schema mirrors JobAttachment so we can reuse the same S3
 * presign service.
 */
@ObjectType({ description: 'File attached to a comment' })
export class CommentAttachment {
  @Field({ description: 'Original filename of the uploaded file', nullable: true })
  filename?: string;

  @Field({ description: 'S3 object key where the file is stored' })
  key: string;

  @Field({ description: 'MIME type of the uploaded file' })
  contentType: string;

  @Field(() => Int, { description: 'Size of the file in bytes' })
  size: number;

  @Field({ description: 'When this attachment was recorded', nullable: true })
  uploadedAt?: Date;

  @Field({ description: 'Temporary URL to download this attachment', nullable: true })
  url?: string;
}

@Schema()
@ObjectType({ description: 'Comments on jobs, allowing both staff and customers to add comments and view comment history' })
export class Comment {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Job.name, required: true })
  @Field(() => ID, { description: 'ID of the job this comment belongs to' })
  jobId: string;

  @Prop({ required: false })
  @Field(() => ID, {
    nullable: true,
    description:
      'Optional WorkflowNode _id this comment is scoped to. Set for technician bench-view notes (per-operation); null for job-level comments. Lets the bench view show notes/files per operation while reusing the job-scoped attachment storage.'
  })
  nodeId?: string;

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

  @Prop({ type: [mongoose.Schema.Types.Mixed], required: false, default: [] })
  @Field(() => [CommentAttachment], {
    nullable: true,
    description: 'Files attached to this comment; each item carries a presigned download URL when resolved.'
  })
  attachments?: CommentAttachment[];

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
CommentSchema.index({ nodeId: 1 });
CommentSchema.index({ createdAt: -1 });
CommentSchema.index({ authorType: 1 });
