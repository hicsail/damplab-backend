import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { Workflow } from './models/workflow.model';
import { WorkflowService } from './workflow.service';
import { AddWorkflowInput } from './dtos/add-workflow.input';

@Resolver(() => Workflow)
export class WorkflowResolver {
  constructor(private readonly workflowService: WorkflowService) {}

  @Mutation(() => Workflow)
  async createWorkflow(@Args('createWorkflowInput') createWorkflowInput: AddWorkflowInput) {
    return this.workflowService.create(createWorkflowInput);
  }

  /**
   * Find a workflow by its name
   */
  @Query(() => Workflow, { nullable: true })
  async workflow(@Args('name') name: string) {
    return this.workflowService.findByName(name);
  }
}
