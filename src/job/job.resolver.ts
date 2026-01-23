import { UseGuards, Inject, forwardRef } from '@nestjs/common';
import { Mutation, ResolveField, Resolver, Query, Args, Parent, ID } from '@nestjs/graphql';
import { CreateJobInput, CreateJobPipe, CreateJobPreProcessed, JobPipe } from './job.dto';
import { Job, JobState } from './job.model';
import { JobService } from './job.service';
import { WorkflowService } from '../workflow/workflow.service';
import { Comment } from '../comment/comment.model';
import { CommentService } from '../comment/comment.service';
import { Workflow } from '../workflow/models/workflow.model';
import { WorkflowPipe } from '../workflow/workflow.pipe';
import { AuthRolesGuard } from '../auth/auth.guard';
import { User } from '../auth/user.interface';
import { CurrentUser } from '../auth/user.decorator';
import { SOW } from '../sow/sow.model';
import { SOWService } from '../sow/sow.service';

@Resolver(() => Job)
@UseGuards(AuthRolesGuard)
export class JobResolver {
  constructor(
    private readonly jobService: JobService,
    private readonly workflowService: WorkflowService,
    @Inject(forwardRef(() => CommentService))
    private readonly commentService: CommentService,
    @Inject(forwardRef(() => SOWService))
    private readonly sowService: SOWService
  ) {}

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

  @Query(() => Job)
  @Roles(Role.DamplabStaff)
  async jobByWorkflowId(@Args('workflow', { type: () => ID }, WorkflowPipe) workflow: Workflow): Promise<Job | null> {
    return this.jobService.findByWorkflow(workflow);
  }

  @Mutation(() => Job)
  async createJob(@Args('createJobInput', { type: () => CreateJobInput }, CreateJobPipe) createJobInput: CreateJobPreProcessed, @CurrentUser() user: User): Promise<Job> {
    return this.jobService.create({ ...createJobInput, username: user.preferred_username, sub: user.sub, email: user.email });
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

  @ResolveField(() => [Comment])
  async comments(@Parent() job: Job): Promise<Comment[]> {
    return this.commentService.findByJob(job._id);
  }

  @ResolveField(() => SOW, { nullable: true, description: 'SOW associated with this job' })
  async sow(@Parent() job: Job): Promise<SOW | null> {
    return this.sowService.findByJobId(job._id);
  }
}
