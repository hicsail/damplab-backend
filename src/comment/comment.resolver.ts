// comment.resolver.ts
import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { Comment } from './comment.model';
import { CommentService } from './comment.service';
import { CreateComment } from './comment.dto';
import { Job } from '../job/job.model';

@Resolver(() => Comment)
export class CommentResolver {
  constructor(private readonly commentService: CommentService) {}

  // add the create to resolver
  @Query(() => [Comment])
  async findAll(): Promise<Comment[]> {
    return this.commentService.findAll();
  }

  @Query(() => [Comment])
  async findByJob(@Args('jobID', { type: () => ID }) jobID: string): Promise<Comment[]> {
    return this.commentService.findByJob(jobID);
  }

  @Mutation(() => Comment)
  async createComment(@Args('newComment') newComment: CreateComment): Promise<Comment> {
    return this.commentService.create(newComment);
  }
}
