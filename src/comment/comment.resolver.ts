import { Resolver, Mutation, Args, Query, ID, ResolveField, Parent } from '@nestjs/graphql';
import { Comment, CommentAttachment, CommentAuthorType } from './comment.model';
import { CommentService } from './comment.service';
import { CreateCommentInput, UpdateCommentInput } from './comment.dto';
import { ForbiddenException, Inject, NotFoundException, UseGuards, forwardRef } from '@nestjs/common';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { ActivityService } from '../activity/activity.service';
import { ActivityEventType } from '../activity/activity-event.model';
import { NotificationDispatchService } from '../notification/notification-dispatch.service';
import { JobAttachmentsService } from '../job/job-attachments.service';
import { isStaff } from '../sow/sow-access';
import { JobService } from '../job/job.service';
import { isJobMember } from '../job/job-membership';
import { hasPermission } from '../auth/permissions/permissions';
import { Permission } from '../auth/permissions/permission.enum';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { STAFF_FLAVORED_ROLES } from '../auth/permissions/role-permissions';

@Resolver(() => Comment)
@UseGuards(AuthRolesGuard)
export class CommentResolver {
  constructor(
    private readonly commentService: CommentService,
    private readonly activityService: ActivityService,
    private readonly notificationDispatch: NotificationDispatchService,
    // Reuse the existing presign service — files for comment attachments live
    // in the same S3 bucket and were uploaded via createJobAttachmentUploadUrls.
    private readonly jobAttachmentsService: JobAttachmentsService,
    @Inject(forwardRef(() => JobService)) private readonly jobService: JobService
  ) {}

  /** Whether the caller is on the job (a member, or someone who sees every job). 404 before 403. */
  private async mayUseJobComments(jobId: string, user: User): Promise<boolean> {
    const job = await this.jobService.findById(String(jobId));
    if (!job) throw new NotFoundException(`Job with ID ${jobId} not found`);
    return hasPermission(user, Permission.JobsViewAll) || isJobMember(job, user);
  }

  /** Who may see and write internal notes: staff-flavoured roles (damplab-staff, technician) or anyone with jobs:view-all. One predicate for create, update, list and by-id. */
  private mayUseInternalComments(user: User): boolean {
    // API keys hold jobs:view-all for the lab monitor's reads but never saw internal notes; keep it so.
    if (user.apiKey) return false;
    const roles = user.realm_access?.roles ?? [];
    return roles.some((r) => STAFF_FLAVORED_ROLES.includes(r)) || hasPermission(user, Permission.JobsViewAll);
  }

  private async assertMayUseJobComments(jobId: string, user: User): Promise<void> {
    if (!(await this.mayUseJobComments(jobId, user))) throw new ForbiddenException('You do not have permission to see the comments on this job');
  }

  /** The author (by the stored author string, compared case-insensitively to the caller's email or username), or damplab-staff. */
  private assertMayChangeComment(comment: Comment, user: User): void {
    if (isStaff(user)) return;
    const author = comment.author?.trim().toLowerCase();
    const mine = [user.email, user.preferred_username].map((v) => v?.trim().toLowerCase()).filter((v): v is string => !!v);
    if (!author || !mine.includes(author)) throw new ForbiddenException('You can only change your own comments');
  }

  /** Resolve each attachment with a fresh presigned download URL. */
  @ResolveField(() => [CommentAttachment], { name: 'attachments', nullable: true })
  async resolveAttachments(@Parent() comment: Comment): Promise<CommentAttachment[]> {
    const raw = comment.attachments ?? [];
    if (!raw.length) return [];
    return Promise.all(
      raw
        .filter((a) => a && typeof a.key === 'string' && a.key.length > 0)
        .map(async (a) => ({
          filename: a.filename,
          key: a.key,
          contentType: a.contentType,
          size: a.size,
          uploadedAt: a.uploadedAt,
          url: (await this.jobAttachmentsService.createPresignedDownload(a.key, a.contentType)) ?? undefined
        }))
    );
  }

  @Query(() => Comment, { nullable: true, description: 'Get comment by ID' })
  @RequirePermission(Permission.JobsView)
  async commentById(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: User): Promise<Comment | null> {
    const comment = await this.commentService.findById(id);
    if (!comment) return null;
    if (!(await this.mayUseJobComments(String(comment.jobId), user))) return null;
    // Same rule commentsByJobId applies: internal notes are staff-only.
    if (comment.isInternal && !this.mayUseInternalComments(user)) return null;
    return comment;
  }

  @Query(() => [Comment], { description: 'Comments on a job. Staff see internal notes too; everyone else sees only what was written for the customer.' })
  @RequirePermission(Permission.JobsView)
  async commentsByJobId(@Args('jobId', { type: () => ID }) jobId: string, @CurrentUser() user: User): Promise<Comment[]> {
    await this.assertMayUseJobComments(jobId, user);
    return this.commentService.findByJobWithVisibility(jobId, this.mayUseInternalComments(user));
  }

  @Query(() => [Comment], { description: 'Get comments scoped to a single workflow node (technician bench-view notes). Same scope and internal-note rule as commentsByJobId.' })
  @RequirePermission(Permission.JobsView)
  async commentsByNodeId(@Args('nodeId', { type: () => ID }) nodeId: string, @CurrentUser() user: User): Promise<Comment[]> {
    const comments = await this.commentService.findByNode(nodeId);
    // A node belongs to one job; the job is the one its comments were written on.
    const jobIds = [...new Set(comments.map((c) => String(c.jobId)))];
    for (const jobId of jobIds) await this.assertMayUseJobComments(jobId, user);
    return this.mayUseInternalComments(user) ? comments : comments.filter((c) => !c.isInternal);
  }

  @Mutation(() => Comment, { description: 'Create a new comment' })
  @RequirePermission(Permission.JobsView)
  async createComment(@Args('input', { type: () => CreateCommentInput }) input: CreateCommentInput, @CurrentUser() user: User): Promise<Comment> {
    await this.assertMayUseJobComments(input.jobId, user);
    // B30: who a comment is from is the caller, never what the page sent and
    // never the job's owner fields. The page used to pass job.email, which on a
    // staff-submitted job was the technician's.
    const author = user.email || user.preferred_username || 'unknown';
    const roles = user.realm_access?.roles ?? [];
    const authorType = roles.some((r) => STAFF_FLAVORED_ROLES.includes(r)) ? CommentAuthorType.STAFF : CommentAuthorType.CLIENT;

    const created = await this.commentService.create({
      ...input,
      // Internal notes are staff-only, the same predicate commentsByJobId uses.
      isInternal: this.mayUseInternalComments(user) ? input.isInternal : false,
      author,
      authorType
    });
    await this.activityService.createEvent({
      type: ActivityEventType.COMMENT_CREATED,
      message: `${authorType === CommentAuthorType.STAFF ? 'Technician' : 'Client'} added a comment`,
      actorDisplayName: author,
      jobId: input.jobId,
      commentId: String((created as any)._id)
    });
    const snippet = input.content.length > 200 ? input.content.slice(0, 200) + '…' : input.content;
    this.notificationDispatch.dispatch({
      eventType: created.isInternal ? 'INTERNAL_COMMENT_CREATED' : 'COMMENT_CREATED',
      title: created.isInternal ? 'New internal comment' : 'New comment on your job',
      message: snippet,
      jobId: input.jobId,
      actorSub: user.sub,
      actorDisplayName: author
    });
    return created;
  }

  @Mutation(() => Comment, { description: 'Update an existing comment' })
  @RequirePermission(Permission.JobsView)
  async updateComment(@Args('id', { type: () => ID }) id: string, @Args('input', { type: () => UpdateCommentInput }) input: UpdateCommentInput, @CurrentUser() user: User): Promise<Comment> {
    const existing = await this.commentService.findById(id);
    if (!existing) throw new NotFoundException(`Comment with ID ${id} not found`);
    await this.assertMayUseJobComments(String(existing.jobId), user);
    this.assertMayChangeComment(existing, user);
    // Only staff-flavoured callers may change visibility.
    const safeInput = this.mayUseInternalComments(user) ? input : { ...input, isInternal: undefined };
    const updated = await this.commentService.update(id, safeInput);
    await this.activityService.createEvent({
      type: ActivityEventType.COMMENT_UPDATED,
      message: `${updated.authorType === 'STAFF' ? 'Technician' : 'Client'} updated a comment`,
      actorDisplayName: updated.author,
      jobId: updated.jobId,
      commentId: id
    });
    return updated;
  }

  @Mutation(() => Boolean, { description: 'Delete a comment' })
  @RequirePermission(Permission.JobsView)
  async deleteComment(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: User): Promise<boolean> {
    const existing = await this.commentService.findById(id);
    if (!existing) return false;
    await this.assertMayUseJobComments(String(existing.jobId), user);
    this.assertMayChangeComment(existing, user);
    const ok = await this.commentService.delete(id);
    if (ok && existing) {
      await this.activityService.createEvent({
        type: ActivityEventType.COMMENT_DELETED,
        message: `${existing.authorType === 'STAFF' ? 'Technician' : 'Client'} deleted a comment`,
        actorDisplayName: existing.author,
        jobId: existing.jobId,
        commentId: id
      });
    }
    return ok;
  }
}
