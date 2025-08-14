import { UseGuards } from '@nestjs/common';
import { Resolver, Query, Mutation, Args, ResolveField, Parent, ID } from '@nestjs/graphql';
import { Workflow, WorkflowState } from './models/workflow.model';
import { WorkflowService } from './workflow.service';
import { WorkflowNode } from './models/node.model';
import { WorkflowNodeService } from './services/node.service';
import { WorkflowEdge } from './models/edge.model';
import { WorkflowEdgeService } from './services/edge.service';
import { WorkflowPipe } from './workflow.pipe';
import { AuthRolesGuard } from '../auth/auth.guard';

@Resolver(() => Workflow)
@UseGuards(AuthRolesGuard)
export class WorkflowResolver {
  constructor(private readonly workflowService: WorkflowService, private readonly nodeService: WorkflowNodeService, private readonly edgeService: WorkflowEdgeService) {}

  @Query(() => Workflow, { nullable: true })
  async workflowById(@Args('id', { type: () => ID }) id: string): Promise<Workflow | null> {
    return this.workflowService.findById(id);
  }

  @Mutation(() => Workflow)
  async changeWorkflowState(@Args('workflow', { type: () => ID }, WorkflowPipe) workflow: Workflow, @Args('newState', { type: () => WorkflowState }) newState: WorkflowState): Promise<Workflow> {
    return (await this.workflowService.updateState(workflow, newState))!;
  }

  @Query(() => [Workflow])
  async getWorkflowByState(@Args('state', { type: () => WorkflowState }) state: WorkflowState): Promise<Workflow[]> {
    return this.workflowService.getByState(state);
  }

  @ResolveField()
  async nodes(@Parent() workflow: Workflow): Promise<WorkflowNode[]> {
    return this.nodeService.getByIDs(workflow.nodes.map((node) => node._id.toString()));
  }

  @ResolveField()
  async edges(@Parent() workflow: Workflow): Promise<WorkflowEdge[]> {
    return this.edgeService.getByIDs(workflow.edges.map((edge) => edge._id.toString()));
  }
}
