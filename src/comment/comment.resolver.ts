import { Resolver, Mutation, Args, Query, ID } from '@nestjs/graphql';
import { Comment } from './comment.model';
import { CommentService } from './comment.service';
import { CreateCommentInput, UpdateCommentInput } from './comment.dto';
import { UseGuards } from '@nestjs/common';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { ActivityService } from '../activity/activity.service';

@Resolver(() => Comment)
@UseGuards(AuthRolesGuard)
export class CommentResolver {
  constructor(
    private readonly commentService: CommentService,
    private readonly activityService: ActivityService
  ) {}

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

    const created = await this.commentService.create({
      ...input,
      author,
      authorType
    });
    await this.activityService.createEvent({
      type: 'COMMENT_CREATED',
      message: `${input.authorType === 'STAFF' ? 'Technician' : 'Client'} added a comment`,
      actorDisplayName: author,
      jobId: input.jobId
    });
    return created;
  }

  @Mutation(() => Comment, { description: 'Update an existing comment' })
  @UseGuards(AuthRolesGuard)
  async updateComment(@Args('id', { type: () => ID }) id: string, @Args('input', { type: () => UpdateCommentInput }) input: UpdateCommentInput): Promise<Comment> {
    const updated = await this.commentService.update(id, input);
    await this.activityService.createEvent({
      type: 'COMMENT_UPDATED',
      message: `${updated.authorType === 'STAFF' ? 'Technician' : 'Client'} updated a comment`,
      actorDisplayName: updated.author,
      jobId: updated.jobId
    });
    return updated;
  }

  @Mutation(() => Boolean, { description: 'Delete a comment' })
  @UseGuards(AuthRolesGuard)
  async deleteComment(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    const existing = await this.commentService.findById(id);
    const ok = await this.commentService.delete(id);
    if (ok && existing) {
      await this.activityService.createEvent({
        type: 'COMMENT_DELETED',
        message: `${existing.authorType === 'STAFF' ? 'Technician' : 'Client'} deleted a comment`,
        actorDisplayName: existing.author,
        jobId: existing.jobId
      });
    }
    return ok;
  }
}
