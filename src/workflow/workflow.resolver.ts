import { UseGuards, Inject, forwardRef, Logger } from '@nestjs/common';
import { Resolver, Query, Mutation, Args, ResolveField, Parent, ID } from '@nestjs/graphql';
import { Workflow, WorkflowState } from './models/workflow.model';
import { WorkflowService } from './workflow.service';
import { WorkflowNode } from './models/node.model';
import { WorkflowNodeService } from './services/node.service';
import { WorkflowEdge } from './models/edge.model';
import { WorkflowEdgeService } from './services/edge.service';
import { WorkflowPipe } from './workflow.pipe';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { Job } from '../job/job.model';
import { JobService } from '../job/job.service';

@Resolver(() => Workflow)
@UseGuards(AuthRolesGuard)
export class WorkflowResolver {
  private readonly logger = new Logger(WorkflowResolver.name);

  constructor(
    private readonly workflowService: WorkflowService,
    private readonly nodeService: WorkflowNodeService,
    private readonly edgeService: WorkflowEdgeService,
    @Inject(forwardRef(() => JobService))
    private readonly jobService: JobService
  ) {}

  @Query(() => Workflow, { nullable: true })
  @RequirePermission(Permission.JobsViewAll)
  async workflowById(@Args('id', { type: () => ID }) id: string): Promise<Workflow | null> {
    return this.workflowService.findById(id);
  }

  @Mutation(() => Workflow)
  @RequirePermission(Permission.LabMonitorView)
  async changeWorkflowState(@Args('workflow', { type: () => ID }, WorkflowPipe) workflow: Workflow, @Args('newState', { type: () => WorkflowState }) newState: WorkflowState): Promise<Workflow> {
    return (await this.workflowService.updateState(workflow, newState))!;
  }

  @Query(() => [Workflow], { deprecationReason: 'Use getWorkflowsByStateForLabMonitor. Retained for the orphaned /dominos board; it now applies the same signed-SOW gate.' })
  @RequirePermission(Permission.LabMonitorView)
  async getWorkflowByState(@Args('state', { type: () => WorkflowState }) state: WorkflowState): Promise<Workflow[]> {
    return this.workflowService.getByState(state);
  }

  @Query(() => [Workflow], {
    description: 'Workflows in this state that belong to jobs accepted by technicians (for lab monitor).'
  })
  @RequirePermission(Permission.LabMonitorView)
  async getWorkflowsByStateForLabMonitor(
    @Args('state', { type: () => WorkflowState }) state: WorkflowState,
    @Args('includeUnsignedSow', { type: () => Boolean, nullable: true, description: 'Staff override: also show approved jobs whose Statement of Work is unsigned, or absent. Off by default.' })
    includeUnsignedSow?: boolean
  ): Promise<Workflow[]> {
    return this.workflowService.getByStateForApprovedJobs(state, includeUnsignedSow === true);
  }

  @ResolveField()
  async nodes(@Parent() workflow: Workflow): Promise<WorkflowNode[]> {
    return this.nodeService.getByIDs(workflow.nodes.map((node) => node._id.toString()));
  }

  /**
   * Dangling edges are dropped rather than returned.
   *
   * `WorkflowEdge.source`/`target` are non-nullable and throw when the node is
   * gone, which fails the *entire* enclosing query — a single bad edge makes the
   * whole job unreadable, for staff as well as the owner. A save that leaves an
   * edge behind is a bug to fix at the write end (see JobVersionService), but
   * this read path should degrade to a missing connection, not to a dead job.
   * Warned rather than silent: dropping one is still data loss worth seeing.
   */
  @ResolveField()
  async edges(@Parent() workflow: Workflow): Promise<WorkflowEdge[]> {
    const edges = await this.edgeService.getByIDs(workflow.edges.map((edge) => edge._id.toString()));
    if (!edges.length) return edges;

    const referenced = [...new Set(edges.flatMap((edge) => [String(edge.source), String(edge.target)]))];
    const present = new Set((await this.nodeService.getByIDs(referenced)).map((node) => String(node._id)));

    const kept = edges.filter((edge) => present.has(String(edge.source)) && present.has(String(edge.target)));
    if (kept.length !== edges.length) {
      this.logger.warn(`Workflow ${String(workflow._id)}: dropped ${edges.length - kept.length} edge(s) referencing missing nodes`);
    }
    return kept;
  }

  @ResolveField(() => Job, { nullable: true, description: 'The parent job this workflow belongs to' })
  async job(@Parent() workflow: Workflow): Promise<Job | null> {
    return this.jobService.findByWorkflow(workflow);
  }
}
