import { Resolver, Mutation, Args, Query, ID } from '@nestjs/graphql';
import { Comment } from './comment.model';
import { CommentService } from './comment.service';
import { CreateCommentInput, UpdateCommentInput } from './comment.dto';
import { UseGuards } from '@nestjs/common';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';

@Resolver(() => Comment)
@UseGuards(AuthRolesGuard)
export class CommentResolver {
  constructor(private readonly commentService: CommentService) {}

  @Query(() => Comment, { nullable: true, description: 'Get comment by ID' })
  async commentById(@Args('id', { type: () => ID }) id: string): Promise<Comment | null> {
    return this.commentService.findById(id);
  }

  @Query(() => [Comment], { description: 'Get all comments for a job' })
  async commentsByJobId(@Args('jobId', { type: () => ID }) jobId: string): Promise<Comment[]> {
    // TODO: Add visibility filtering based on user role
    // For now, return all comments (visibility filtering can be added later based on auth context)
    return this.commentService.findByJob(jobId);
  }

  @Mutation(() => Comment, { description: 'Create a new comment' })
  @UseGuards(AuthRolesGuard)
  async createComment(@Args('input', { type: () => CreateCommentInput }) input: CreateCommentInput, @CurrentUser() user: User): Promise<Comment> {
    // Auto-populate author from current user if not provided
    const author = input.author || user.email || user.preferred_username || 'unknown';

    // Use provided authorType, or determine from user email domain as fallback
    // In a production scenario, you'd check user roles/permissions from the auth system
    const authorType = input.authorType || (user.email?.includes('@bu.edu') ? 'STAFF' : 'CLIENT');

    return this.commentService.create({
      ...input,
      author,
      authorType
    });
  }

  @Mutation(() => Comment, { description: 'Update an existing comment' })
  @UseGuards(AuthRolesGuard)
  async updateComment(@Args('id', { type: () => ID }) id: string, @Args('input', { type: () => UpdateCommentInput }) input: UpdateCommentInput): Promise<Comment> {
    return this.commentService.update(id, input);
  }

  @Mutation(() => Boolean, { description: 'Delete a comment' })
  @UseGuards(AuthRolesGuard)
  async deleteComment(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.commentService.delete(id);
  }
}
