import { InputType, Field, ID } from '@nestjs/graphql';
import { CommentAuthorType } from './comment.model';

@InputType()
export class CreateCommentInput {
  @Field(() => ID, { description: 'ID of the job this comment belongs to' })
  jobId: string;

  @Field({ description: 'Content of the comment' })
  content: string;

  @Field({ description: 'Username or email of the person creating the comment' })
  author: string;

  @Field(() => CommentAuthorType, { description: 'Type of author (STAFF or CLIENT)' })
  authorType: CommentAuthorType;

  @Field({ description: 'If true, only visible to staff; if false, visible to both staff and client', defaultValue: false, nullable: true })
  isInternal?: boolean;
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
