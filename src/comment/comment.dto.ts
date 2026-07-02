import { InputType, Field, ID, Int } from '@nestjs/graphql';
import { CommentAuthorType } from './comment.model';

/**
 * One attachment input on a CreateComment call. The frontend uploads each
 * file to S3 via a presigned URL (the existing createJobAttachmentUploadUrls
 * mutation, which is fine to reuse — the S3 path is the same) and then
 * passes the resulting key/filename/contentType/size here.
 */
@InputType()
export class CommentAttachmentInput {
  @Field({ description: 'Original filename', nullable: true })
  filename?: string;

  @Field({ description: 'S3 object key returned by the upload URL request' })
  key: string;

  @Field({ description: 'MIME type' })
  contentType: string;

  @Field(() => Int, { description: 'Size in bytes' })
  size: number;
}

@InputType()
export class CreateCommentInput {
  @Field(() => ID, { description: 'ID of the job this comment belongs to' })
  jobId: string;

  @Field(() => ID, {
    description: 'Optional WorkflowNode _id to scope this comment to (technician bench-view note for one operation).',
    nullable: true
  })
  nodeId?: string;

  @Field({ description: 'Content of the comment' })
  content: string;

  @Field({ description: 'Username or email of the person creating the comment' })
  author: string;

  @Field(() => CommentAuthorType, { description: 'Type of author (STAFF or CLIENT)' })
  authorType: CommentAuthorType;

  @Field({ description: 'If true, only visible to staff; if false, visible to both staff and client', defaultValue: false, nullable: true })
  isInternal?: boolean;

  @Field(() => [CommentAttachmentInput], { description: 'Files already uploaded to S3 to attach to this comment.', nullable: true })
  attachments?: CommentAttachmentInput[];
}

@InputType()
export class UpdateCommentInput {
  @Field({ description: 'Updated content of the comment', nullable: true })
  content?: string;

  @Field({ description: 'Updated visibility setting', nullable: true })
  isInternal?: boolean;
}

// Legacy DTO for backward compatibility
@InputType()
export class CreateComment {
  @Field({ description: 'Comment text message' })
  message: string;

  @Field(() => ID, { description: 'Job which the comment is under' })
  job: string;
}
