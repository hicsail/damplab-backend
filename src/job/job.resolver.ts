import { UseGuards, Inject, forwardRef, Logger, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Mutation, ResolveField, Resolver, Query, Args, Parent, ID, Int } from '@nestjs/graphql';
import { CreateJobInput, CreateJobPipe, CreateJobPreProcessed, JobAttachmentInput, JobAttachmentUpload, JobAttachmentUploadRequest, JobPipe } from './job.dto';
import { OwnJobsInput, AllJobsInput, OwnJobsResult, JobsResult } from './dto/jobs-query.dto';
import { Job, JobAttachment, JobState, CustomerCategory } from './job.model';
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
import { SowVersionService } from '../sow/sow-version.service';
import { JobAttachmentsService } from './job-attachments.service';
import { WorkflowNodeService } from '../workflow/services/node.service';
import { UpdateSOWInput } from '../sow/dto/update-sow.input';
import { JobFeedStatus } from './job-feed-status.model';
import { ActivityService } from '../activity/activity.service';
import { AddWorkflowInput, AddWorkflowInputFull, AddWorkflowInputPipe } from '../workflow/dtos/add-workflow.input';
import { JobVersion, JobVersionAuthorRole } from '../job-version/job-version.model';
import { JobVersionService } from '../job-version/job-version.service';
import { SaveJobWorkflowsInput } from '../job-version/job-version.dto';
import { KeycloakService } from '../keycloak/keycloak.service';

@Resolver(() => Job)
@UseGuards(AuthRolesGuard)
export class JobResolver {
  private readonly logger = new Logger(JobResolver.name);

  /**
   * Rebuild SOW line items from all workflows on the job (ordered nodes).
   * Keeps invoice / SOW in sync when workflows are added (e.g. addWorkflowToJob) or repriced.
   */
  /**
   * SOW line items for every node on the job's workflows, in workflow order.
   *
   * `existingServices` lets the sync path keep whatever staff have edited on a line
   * that is still there. Creation passes nothing, because there is no prior
   * document to preserve — and the positional match below is fragile enough that
   * it should never be handed an array it was not built from.
   *
   * `formData` always travels with the line: service cost is recomputed downstream
   * from the service record plus this data, and the run-count multiplier lives
   * inside it.
   */
  private async collectSowServiceInputs(job: Job, existingServices: any[] = []): Promise<any[]> {
    const orderedNodes: any[] = [];
    for (const workflowId of job.workflows ?? []) {
      const workflow = await this.workflowService.findById(String(workflowId));
      if (!workflow) continue;

      const nodeIds = (workflow.nodes ?? []).map((n: any) => String(n));
      if (!nodeIds.length) continue;

      const nodes = await this.workflowNodeService.getByIDs(nodeIds);
      const byId = new Map(nodes.map((n: any) => [String(n._id), n]));

      for (const nodeId of nodeIds) {
        const node = byId.get(nodeId);
        if (node) orderedNodes.push(node);
      }
    }

    return orderedNodes.map((node: any, idx: number) => {
      const existing = existingServices[idx];
      const serviceId = String(node.service?._id ?? node.service);

      return {
        id: serviceId,
        name: existing?.name ?? node.label ?? 'Service',
        description: existing?.description ?? node.label ?? 'Service',
        // A unit price, not a line total: transformServices multiplies whatever
        // arrives here by the node's multiplier when the service record carries
        // no price of its own.
        unitCost: existing?.unitCost ?? node.price ?? 0,
        cost: existing?.cost ?? node.price ?? 0,
        category: existing?.category ?? 'molecular-biology',
        formData: node.formData ?? []
      };
    });
  }

  private async syncSowServicesFromJobWorkflows(jobId: string): Promise<void> {
    const job = await this.jobService.findById(jobId);
    if (!job) return;

    const existingSow = await this.sowService.findByJobId(jobId);
    if (!existingSow) return;

    const servicesInput = await this.collectSowServiceInputs(job, existingSow.services ?? []);
    if (servicesInput.length === 0) return;

    const updateInput: UpdateSOWInput = { services: servicesInput } as any;
    await this.sowService.update(String(existingSow._id), updateInput);

    // The billing core has moved; the SOW *document* has not. Flag it so staff
    // see a banner and choose whether to revise, rather than silently rewriting a
    // document that may already be sent, signed or finalized.
    await this.sowVersionService.refreshDocumentStale(String(existingSow._id));
  }

  constructor(
    private readonly jobService: JobService,
    private readonly workflowService: WorkflowService,
    private readonly workflowNodeService: WorkflowNodeService,
    private readonly activityService: ActivityService,
    @Inject(forwardRef(() => CommentService))
    private readonly commentService: CommentService,
    @Inject(forwardRef(() => SOWService))
    private readonly sowService: SOWService,
    @Inject(forwardRef(() => SowVersionService))
    private readonly sowVersionService: SowVersionService,
    private readonly jobAttachmentsService: JobAttachmentsService,
    private readonly jobVersionService: JobVersionService,
    private readonly keycloakService: KeycloakService
  ) {}

  /**
   * Which side of the conversation a caller writes as. Staff editing their own
   * job still write as STAFF — the baseline rule is about the two sides of the
   * review, not about identity.
   */
  private authorRoleFor(user: User): JobVersionAuthorRole {
    return (user.realm_access?.roles ?? []).includes(Role.DamplabStaff) ? JobVersionAuthorRole.STAFF : JobVersionAuthorRole.CUSTOMER;
  }

  /**
   * How a state transition reads in the version history. Only the transitions
   * that are part of the customer/staff conversation get an entry — the internal
   * lab pipeline (QUEUED → IN_PROGRESS → COMPLETE) is already tracked per node
   * and would just add noise to a list about document revisions.
   */
  private static readonly STATE_EVENT_NOTES: Partial<Record<JobState, string>> = {
    [JobState.CHANGES_REQUESTED]: 'Changes requested',
    [JobState.SUBMITTED]: 'Submitted',
    [JobState.ACCEPTED]: 'Accepted',
    [JobState.REJECTED]: 'Rejected',
    [JobState.CLOSED]: 'Closed'
  };

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

  @Query(() => JobFeedStatus, {
    description: 'Staff-only. Global unseen/submitted jobs feed status for the Home Jobs button badge.'
  })
  @Roles(Role.DamplabStaff)
  async jobsFeedStatus(): Promise<JobFeedStatus> {
    return this.jobService.getJobsFeedStatus();
  }

  @Mutation(() => JobFeedStatus, {
    description: 'Staff-only. Marks the shared jobs feed as viewed by setting the global viewed timestamp.'
  })
  @Roles(Role.DamplabStaff)
  async markJobsFeedViewed(): Promise<JobFeedStatus> {
    return this.jobService.markJobsFeedViewed();
  }

  @Mutation(() => Job)
  async createJob(@Args('createJobInput', { type: () => CreateJobInput }, CreateJobPipe) createJobInput: CreateJobPreProcessed, @CurrentUser() user: User): Promise<Job> {
    const roles = user.realm_access?.roles ?? [];
    const groups = user.groups ?? [];
    const claims = [...roles, ...groups];
    const hasGroup = (groupName: string): boolean => claims.some((entry) => entry === groupName || entry.endsWith(`/${groupName}`));

    const customerCategory: CustomerCategory | undefined =
      hasGroup(Role.InternalCustomers) || hasGroup(Role.InternalCustomer)
        ? CustomerCategory.INTERNAL_CUSTOMERS
        : hasGroup(Role.ExternalCustomerAcademic)
        ? CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC
        : hasGroup(Role.ExternalCustomerMarket)
        ? CustomerCategory.EXTERNAL_CUSTOMER_MARKET
        : hasGroup(Role.ExternalCustomerNoSalary)
        ? CustomerCategory.EXTERNAL_CUSTOMER_NO_SALARY
        : hasGroup(Role.ExternalCustomer)
        ? CustomerCategory.EXTERNAL_CUSTOMER_MARKET
        : undefined;
    const created = await this.jobService.create({
      ...createJobInput,
      username: user.preferred_username,
      clientDisplayName: (createJobInput as any)?.clientDisplayName,
      sub: user.sub,
      email: user.email,
      customerCategory
    });
    // v1 is the submission itself, so the first technician edit has something to
    // diff against.
    await this.jobVersionService.appendVersion(created, await this.jobVersionService.snapshotLiveWorkflows(created), {
      authorRole: this.authorRoleFor(user),
      createdBy: user.sub,
      createdByName: user.preferred_username ?? user.email ?? '',
      note: 'Original submission',
      bumpMajor: true,
      visibleToCustomer: true
    });

    await this.activityService.createEvent({
      type: 'JOB_SUBMITTED',
      message: `Job "${created.name}" was submitted`,
      actorDisplayName: user.preferred_username ?? user.email ?? undefined,
      jobId: String(created._id)
    });
    return created;
  }

  @Mutation(() => Job, {
    description:
      'Staff-only. Archive a job: hides it from the default jobs dashboard and the live lab boards while retaining everything. Permitted even when the job is IN_PROGRESS — the caller is expected to have confirmed — and the state at archive time is recorded.'
  })
  @Roles(Role.DamplabStaff)
  async archiveJob(@Args('jobId', { type: () => ID }) jobId: string, @CurrentUser() user: User): Promise<Job> {
    const actor = user?.email || user?.preferred_username || 'unknown';
    const updated = await this.jobService.setArchived(jobId, true, actor);
    if (!updated) {
      throw new NotFoundException(`Job with ID ${jobId} not found`);
    }
    await this.activityService.createEvent({
      type: 'JOB_ARCHIVED',
      jobId,
      actorDisplayName: actor,
      message: `Job "${updated.name}" archived (state at archive: ${JobState[updated.archivedFromState ?? updated.state]})`
    });
    return updated;
  }

  @Mutation(() => Job, {
    description: 'Staff-only. Restore an archived job, putting it back in the dashboard and on the live boards. Its lifecycle state was never changed, so it returns exactly where it left off.'
  })
  @Roles(Role.DamplabStaff)
  async unarchiveJob(@Args('jobId', { type: () => ID }) jobId: string, @CurrentUser() user: User): Promise<Job> {
    const actor = user?.email || user?.preferred_username || 'unknown';
    const updated = await this.jobService.setArchived(jobId, false, actor);
    if (!updated) {
      throw new NotFoundException(`Job with ID ${jobId} not found`);
    }
    await this.activityService.createEvent({
      type: 'JOB_UNARCHIVED',
      jobId,
      actorDisplayName: actor,
      message: `Job "${updated.name}" restored from archive`
    });
    return updated;
  }

  @Mutation(() => Job, {
    description: 'Staff-only. Add a new workflow (service(s) + parameters) to an existing job.'
  })
  @Roles(Role.DamplabStaff)
  async addWorkflowToJob(
    @Args('jobId', { type: () => ID }) jobId: string,
    @Args('workflow', { type: () => AddWorkflowInput }, AddWorkflowInputPipe) workflow: AddWorkflowInputFull,
    @CurrentUser() user: User
  ): Promise<Job> {
    const job = await this.jobService.findById(jobId);
    if (!job) {
      throw new NotFoundException(`Job with ID ${jobId} not found`);
    }

    const updated = await this.jobService.addWorkflow(jobId, workflow);
    if (!updated) {
      throw new Error('Unable to update job with new workflow');
    }

    await this.syncSowServicesFromJobWorkflows(jobId);

    await this.activityService.createEvent({
      type: 'JOB_UPDATED',
      message: `Added workflow "${workflow?.name ?? 'Workflow'}" to job "${job.name}"`,
      actorDisplayName: user.preferred_username ?? user.email ?? undefined,
      jobId: String(job._id)
    });

    return updated;
  }

  @Mutation(() => Job, {
    description:
      'Change pricing category for a job owner: updates their Keycloak pricing group, every job under that account, and reprices SOW billing cores (documents stay stale until staff refresh).'
  })
  async changeJobCustomerCategory(
    @Args('jobId', { type: () => ID }) jobId: string,
    @Args('customerCategory', { type: () => CustomerCategory }) customerCategory: CustomerCategory,
    @CurrentUser() user: User
  ): Promise<Job> {
    const job = await this.jobService.findById(jobId);
    if (!job) {
      throw new NotFoundException(`Job with ID ${jobId} not found`);
    }

    const roles = user.realm_access?.roles ?? [];
    const isStaff = roles.includes(Role.DamplabStaff);
    const isOwner = job.sub === user.sub;
    if (!isStaff && !isOwner) {
      throw new ForbiddenException('You do not have permission to change customer category for this job');
    }

    // Account-wide: Keycloak group first (staff path / when Admin API is available), then all jobs for this sub.
    if (job.sub && this.keycloakService.isConfigured()) {
      try {
        await this.keycloakService.setUserCustomerCategory(job.sub, customerCategory);
      } catch (err) {
        this.logger.error(`Failed to update Keycloak pricing category for sub=${job.sub}`, err instanceof Error ? err.stack : err);
        throw new BadRequestException('Could not update the customer pricing category in Keycloak. Job categories were not changed.');
      }
    } else if (job.sub && !this.keycloakService.isConfigured()) {
      this.logger.warn(`Keycloak Admin API not configured; updating job categories for sub=${job.sub} without Keycloak sync`);
    }

    let updatedJobs: Job[];
    if (job.sub) {
      updatedJobs = await this.jobService.updateCustomerCategoryForSub(job.sub, customerCategory);
    } else {
      const single = await this.jobService.updateCustomerCategory(jobId, customerCategory);
      updatedJobs = single ? [single] : [];
    }

    for (const j of updatedJobs) {
      await this.syncSowServicesFromJobWorkflows(String(j._id));
    }

    const updatedJob = updatedJobs.find((j) => String(j._id) === String(jobId)) ?? (await this.jobService.findById(jobId));
    return updatedJob ?? job;
  }

  @Mutation(() => SOW, {
    description: "Staff-only. Create the first Statement of Work for a job, built from the job's workflows. Returns the existing SOW if the job already has one."
  })
  @Roles(Role.DamplabStaff)
  async createSowForJob(@Args('jobId', { type: () => ID }) jobId: string, @CurrentUser() user: User): Promise<SOW> {
    const job = await this.jobService.findById(jobId);
    if (!job) {
      throw new NotFoundException(`Job with ID ${jobId} not found`);
    }

    const services = await this.collectSowServiceInputs(job);
    const createdBy = user.email || user.preferred_username || 'unknown';

    return this.sowService.createForJob(jobId, services, createdBy);
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
    const roles = user.realm_access?.roles ?? [];
    const isOwner = job.sub === user.sub;
    const isStaff = roles.includes(Role.DamplabStaff);
    if (!isOwner && !isStaff) {
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
    const roles = user.realm_access?.roles ?? [];
    const isOwner = job.sub === user.sub;
    const isStaff = roles.includes(Role.DamplabStaff);
    if (!isOwner && !isStaff) {
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

  /**
   * Staff, or the job's owner. Owners need this so "Resubmit job" can put a
   * job that came back as CHANGES_REQUESTED into SUBMITTED again; they are held
   * to exactly that transition so the customer cannot walk their own job
   * through the lab's pipeline.
   */
  @Mutation(() => Job)
  async changeJobState(@Args('job', { type: () => ID }, JobPipe) job: Job, @Args('newState', { type: () => JobState }) newState: JobState, @CurrentUser() user: User): Promise<Job> {
    const isStaff = (user.realm_access?.roles ?? []).includes(Role.DamplabStaff);
    if (!isStaff) {
      const isOwner = job.sub === user.sub;
      const isResubmission = job.state === JobState.CHANGES_REQUESTED && newState === JobState.SUBMITTED;
      if (!isOwner || !isResubmission) {
        throw new ForbiddenException('You do not have permission to change the state of this job');
      }
    }

    const wasResubmission = job.state === JobState.CHANGES_REQUESTED && newState === JobState.SUBMITTED;
    const updated = (await this.jobService.updateState(job, newState))!;

    // Recorded after the state actually moved, so a failed transition leaves no
    // entry. A resubmission is called out by name: "Submitted" on the second
    // pass would read as a duplicate of the original submission.
    const note = wasResubmission ? 'Resubmitted' : JobResolver.STATE_EVENT_NOTES[newState];
    if (note) {
      await this.jobVersionService.appendStateEvent(updated, newState, { role: this.authorRoleFor(user), sub: user.sub, name: user.preferred_username ?? user.email ?? '' }, note);
    }

    return updated;
  }

  /**
   * Replace the job's workflow graph with what the editor produced, and record
   * the result as a new version.
   *
   * Staff may edit any job that is not CLOSED. Customers may edit only their own
   * job, and only while changes have been requested of them.
   */
  @Mutation(() => Job, {
    description: "Replace a job's workflow graph from the workflow editor and record the result as a new job version."
  })
  async saveJobWorkflows(@Args('input', { type: () => SaveJobWorkflowsInput }) input: SaveJobWorkflowsInput, @CurrentUser() user: User): Promise<Job> {
    const job = await this.jobService.findById(input.jobId);
    if (!job) {
      throw new NotFoundException(`Job with ID ${input.jobId} not found`);
    }

    const isStaff = (user.realm_access?.roles ?? []).includes(Role.DamplabStaff);
    if (isStaff) {
      if (job.state === JobState.CLOSED) {
        throw new ForbiddenException('This job is closed and can no longer be edited');
      }
    } else if (job.sub !== user.sub) {
      throw new ForbiddenException('You do not have permission to edit this job');
    } else if (job.state !== JobState.CHANGES_REQUESTED) {
      throw new ForbiddenException('This job can only be edited while changes have been requested');
    }

    const updated = await this.jobVersionService.saveWorkflows(input, {
      role: this.authorRoleFor(user),
      sub: user.sub,
      name: user.preferred_username ?? user.email ?? ''
    });

    // The billing core has moved. This is a no-op on a job with no SOW, which is
    // most jobs being edited; where there is one it flags the document stale so
    // staff can decide whether to issue a new version for re-signature.
    await this.syncSowServicesFromJobWorkflows(input.jobId);

    await this.activityService.createEvent({
      type: 'JOB_WORKFLOWS_EDITED',
      message: `Workflows edited on job "${job.name}"${input.note ? `: ${input.note}` : ''}`,
      actorDisplayName: user.preferred_username ?? user.email ?? undefined,
      jobId: input.jobId
    });

    return updated;
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
    const base = (job.attachments ?? []).filter((a) => a && typeof a.filename === 'string' && a.filename.length > 0 && typeof a.key === 'string' && a.key.length > 0);
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

  @ResolveField(() => [JobVersion], {
    description: "Saved versions of this job's workflow graph, oldest first. Staff see every row; customers see published rows plus their own."
  })
  async versions(@Parent() job: Job, @CurrentUser() user: User): Promise<JobVersion[]> {
    const all = await this.jobVersionService.listByJob(String(job._id));
    const isStaff = (user?.realm_access?.roles ?? []).includes(Role.DamplabStaff);
    return isStaff ? all : JobVersionService.filterVisibleToCustomer(all);
  }

  @ResolveField(() => Int, {
    nullable: true,
    description: 'Newest content versionNumber on the job, including unpublished staff drafts. Used by the editor conflict check; not a customer graph source.'
  })
  async latestContentVersionNumber(@Parent() job: Job): Promise<number | null> {
    const all = await this.jobVersionService.listByJob(String(job._id));
    return JobVersionService.latestContentVersionNumber(all);
  }
}
