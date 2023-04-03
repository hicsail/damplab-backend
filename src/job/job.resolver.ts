import { Mutation, ResolveField, Resolver, Query, Args, Parent, ID } from '@nestjs/graphql';
import { CreateJob, CreateJobPipe, CreateJobFull, JobPipe } from './job.dto';
import { Job, JobState } from './job.model';
import { JobService } from './job.service';
import { WorkflowService } from '../workflow/workflow.service';
import { Workflow } from '../workflow/models/workflow.model';
import { WorkflowPipe } from '../workflow/workflow.pipe';

@Resolver(() => Job)
export class JobResolver {
  constructor(private readonly jobService: JobService, private readonly workflowService: WorkflowService) {}

  @Query(() => Job, { nullable: true })
  async jobByName(@Args('name') name: string): Promise<Job | null> {
    return this.jobService.findByName(name);
  }

  @Query(() => Job, { nullable: true })
  async jobById(@Args('id', { type: () => ID }) id: string): Promise<Job | null> {
    return this.jobService.findById(id);
  }

  @Query(() => Job)
  async jobByWorkflowId(@Args('workflow', { type: () => ID }, WorkflowPipe) workflow: Workflow): Promise<Job | null> {
    return this.jobService.findByWorkflow(workflow);
  }

  @Mutation(() => Job)
  async createJob(@Args('createJobInput', { type: () => CreateJob }, CreateJobPipe) createJobInput: CreateJobFull): Promise<Job> {
    return this.jobService.create(createJobInput);
  }

  @Mutation(() => Job)
  async changeJobState(@Args('job', { type: () => ID}, JobPipe) job: Job, @Args('newState', { type: () => JobState }) newState: JobState) {
    return this.jobService.updateState(job, newState);
  }

  @ResolveField()
  async workflows(@Parent() job: Job): Promise<Workflow[]> {
    return this.workflowService.findByIds(job.workflows.map((workflow) => workflow._id));
  }
}
