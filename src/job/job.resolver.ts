import { UseGuards, Inject, forwardRef, Logger } from '@nestjs/common';
import { Mutation, ResolveField, Resolver, Query, Args, Parent, ID } from '@nestjs/graphql';
import {
  CreateJobInput,
  CreateJobPipe,
  CreateJobPreProcessed,
  JobAttachmentInput,
  JobAttachmentUpload,
  JobAttachmentUploadRequest,
  JobPipe
} from './job.dto';
import { OwnJobsInput, AllJobsInput, OwnJobsResult, JobsResult } from './dto/jobs-query.dto';
import { Job, JobAttachment, JobState } from './job.model';
import { JobService } from './job.service';
import { WorkflowService } from '../workflow/workflow.service';
import { Comment } from '../comment/comment.model';
import { CommentService } from '../comment/comment.service';
import { Workflow } from '../workflow/models/workflow.model';
import { WorkflowPipe } from '../workflow/workflow.pipe';
import { AuthRolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/roles.enum';
import { User } from '../auth/user.interface';
import { CurrentUser } from '../auth/user.decorator';
import { SOW } from '../sow/sow.model';
import { SOWService } from '../sow/sow.service';
import { JobAttachmentsService } from './job-attachments.service';

@Resolver(() => Job)
@UseGuards(AuthRolesGuard)
export class JobResolver {
  private readonly logger = new Logger(JobResolver.name);

  constructor(
    private readonly jobService: JobService,
    private readonly workflowService: WorkflowService,
    @Inject(forwardRef(() => CommentService))
    private readonly commentService: CommentService,
    @Inject(forwardRef(() => SOWService))
    private readonly sowService: SOWService,
    private readonly jobAttachmentsService: JobAttachmentsService
  ) {}

  @Query(() => [Job])
  @Roles(Role.DamplabStaff)
  async jobs(): Promise<Job[]> {
    return this.jobService.findAll();
  }

  @Query(() => OwnJobsResult, {
    description: 'Paginated, filterable list of jobs for the current user (My Jobs).'
  })
  async ownJobs(@Args('input', { type: () => OwnJobsInput, nullable: true }) input: OwnJobsInput | null, @CurrentUser() user: User): Promise<OwnJobsResult> {
    return this.jobService.findOwnJobsPaginated(user.sub, input ?? {});
  }

  @Query(() => JobsResult, {
    description: 'Staff-only. Paginated, filterable list of all jobs (Dashboard).'
  })
  @Roles(Role.DamplabStaff)
  async allJobs(@Args('input', { type: () => AllJobsInput, nullable: true }) input: AllJobsInput | null): Promise<JobsResult> {
    return this.jobService.findAllJobsPaginated(input ?? {});
  }

  @Query(() => Job, { nullable: true })
  @Roles(Role.DamplabStaff)
  async jobByName(@Args('name') name: string): Promise<Job | null> {
    return this.jobService.findByName(name);
  }

  @Query(() => Job, { nullable: true })
  @Roles(Role.DamplabStaff)
  async jobById(@Args('id', { type: () => ID }) id: string): Promise<Job | null> {
    return this.jobService.findById(id);
  }

  @Query(() => Job, { nullable: true })
  async ownJobById(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: User): Promise<Job | null> {
    const job = await this.jobService.findById(id);
    if (job?.sub === user.sub) {
      return job;
    } else {
      return null;
    }
  }

  @Query(() => Job)
  @Roles(Role.DamplabStaff)
  async jobByWorkflowId(@Args('workflow', { type: () => ID }, WorkflowPipe) workflow: Workflow): Promise<Job | null> {
    return this.jobService.findByWorkflow(workflow);
  }

  @Mutation(() => Job)
  async createJob(@Args('createJobInput', { type: () => CreateJobInput }, CreateJobPipe) createJobInput: CreateJobPreProcessed, @CurrentUser() user: User): Promise<Job> {
    return this.jobService.create({ ...createJobInput, username: user.preferred_username, sub: user.sub, email: user.email });
  }

  @Mutation(() => [JobAttachmentUpload], {
    description: 'Create presigned S3 URLs to upload one or more attachments for a job owned by the current user.'
  })
  async createJobAttachmentUploadUrls(
    @Args('jobId', { type: () => ID }) jobId: string,
    @Args('files', { type: () => [JobAttachmentUploadRequest] }) files: JobAttachmentUploadRequest[],
    @CurrentUser() user: User
  ): Promise<JobAttachmentUpload[]> {
    this.logger.log(`createJobAttachmentUploadUrls called for jobId=${jobId} with ${files.length} file(s)`);
    const job = await this.jobService.findById(jobId);
    if (!job) {
      throw new Error('Job not found');
    }
    if (job.sub !== user.sub) {
      throw new Error('You do not have permission to modify this job');
    }

    const uploads = await Promise.all(
      files.map((file) =>
        this.jobAttachmentsService.createPresignedUpload({
          jobId,
          filename: file.filename,
          contentType: file.contentType,
          size: file.size
        })
      )
    );

    return uploads;
  }

  @Mutation(() => Job, {
    description: 'Record uploaded attachments for a job so they appear in tracking views.'
  })
  async addJobAttachments(
    @Args('jobId', { type: () => ID }) jobId: string,
    @Args('attachments', { type: () => [JobAttachmentInput] }) attachments: JobAttachmentInput[],
    @CurrentUser() user: User
  ): Promise<Job> {
    this.logger.log(`addJobAttachments called for jobId=${jobId} with ${attachments.length} attachment(s)`);
    const job = await this.jobService.findById(jobId);
    if (!job) {
      throw new Error('Job not found');
    }
    if (job.sub !== user.sub) {
      throw new Error('You do not have permission to modify this job');
    }

    const mapped: JobAttachment[] = attachments.map((a) => ({
      filename: a.filename,
      key: a.key,
      contentType: a.contentType,
      size: a.size,
      uploadedAt: new Date()
    }));

    const updated = await this.jobService.addAttachments(jobId, mapped);
    if (!updated) {
      throw new Error('Unable to update job attachments');
    }
    return updated;
  }

  @Mutation(() => Job)
  @Roles(Role.DamplabStaff)
  async changeJobState(@Args('job', { type: () => ID }, JobPipe) job: Job, @Args('newState', { type: () => JobState }) newState: JobState): Promise<Job> {
    return (await this.jobService.updateState(job, newState))!;
  }

  @ResolveField()
  async workflows(@Parent() job: Job): Promise<Workflow[]> {
    return this.workflowService.findByIds(job.workflows.map((workflow) => workflow._id));
  }

  @ResolveField(() => [JobAttachment], {
    name: 'attachments',
    description: 'Attachments for this job, with temporary download URLs when available'
  })
  async attachments(@Parent() job: Job): Promise<JobAttachment[]> {
    this.logger.log(`Resolving attachments for jobId=${job._id}`);
    this.logger.debug(`Raw attachments from DB: ${JSON.stringify(job.attachments ?? [])}`);
    const base = (job.attachments ?? []).filter(
      (a) => a && typeof a.filename === 'string' && a.filename.length > 0 && typeof a.key === 'string' && a.key.length > 0
    );
    if (!base.length) {
      return [];
    }

    const withUrls = await Promise.all(
      base.map(async (a) => {
        const url = await this.jobAttachmentsService.createPresignedDownload(a.key, a.contentType);
        const result: JobAttachment = {
          filename: a.filename,
          key: a.key,
          contentType: a.contentType,
          size: a.size,
          uploadedAt: a.uploadedAt,
          url: url ?? undefined
        };
        this.logger.debug(`Resolved attachment: ${JSON.stringify(result)}`);
        return result;
      })
    );

    return withUrls;
  }

  @ResolveField(() => [Comment])
  async comments(@Parent() job: Job): Promise<Comment[]> {
    return this.commentService.findByJob(job._id);
  }

  @ResolveField(() => SOW, { nullable: true, description: 'SOW associated with this job' })
  async sow(@Parent() job: Job): Promise<SOW | null> {
    return this.sowService.findByJobId(job._id);
  }
}
