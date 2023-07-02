import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { Comment } from './comment.model';
import { CommentService } from './comment.service';
import { CreateComment } from './comment.dto';

@Resolver(() => Comment)
export class CommentResolver {
  constructor(private readonly commentService: CommentService) {}
  
  @Mutation(() => Comment)
  async createComment(@Args('newComment') newComment: CreateComment): Promise<Comment> {
    return this.commentService.create(newComment);
  }
}
