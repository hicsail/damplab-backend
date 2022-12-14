import { Resolver, Query, Mutation, Args, ResolveField, Parent } from '@nestjs/graphql';
import { Workflow } from './models/workflow.model';
import { WorkflowService } from './workflow.service';
import { AddWorkflowInput } from './dtos/add-workflow.input';
import { WorkflowNode } from './models/node.model';
import { WorkflowNodeService } from './services/node.service';
import { WorkflowEdge } from './models/edge.model';
import { WorkflowEdgeService } from './services/edge.service';

@Resolver(() => Workflow)
export class WorkflowResolver {
  constructor(private readonly workflowService: WorkflowService, private readonly nodeService: WorkflowNodeService, private readonly edgeService: WorkflowEdgeService) {}

  @Mutation(() => Workflow)
  async createWorkflow(@Args('createWorkflowInput') createWorkflowInput: AddWorkflowInput): Promise<Workflow> {
    return this.workflowService.create(createWorkflowInput);
  }

  /**
   * Find a workflow by its name
   */
  @Query(() => Workflow, { nullable: true })
  async workflow(@Args('name') name: string): Promise<Workflow | null> {
    return this.workflowService.findByName(name);
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
