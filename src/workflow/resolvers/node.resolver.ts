import { WorkflowNode, WorkflowNodeState } from '../models/node.model';
import { Parent, Resolver, ResolveField, Mutation, ID, Args } from '@nestjs/graphql';
import { DampLabServices } from '../../services/damplab-services.services';
import { DampLabService } from '../../services/models/damplab-service.model';
import mongoose from 'mongoose';
import { WorkflowNodePipe } from '../node.pipe';
import { WorkflowNodeService } from '../services/node.service';

@Resolver(() => WorkflowNode)
export class WorkflowNodeResolver {
  constructor(private readonly damplabServices: DampLabServices,
              private readonly nodeService: WorkflowNodeService) {}

  @Mutation(() => WorkflowNode)
  async changeWorkflowNodeState(@Args('workflowNode', { type: () => ID }, WorkflowNodePipe) workflowNode: WorkflowNode, @Args('newState', { type: () => WorkflowNodeState }) newState: WorkflowNodeState): Promise<WorkflowNode> {
    return (await this.nodeService.updateState(workflowNode, newState))!;
  }


  @ResolveField()
  async service(@Parent() node: WorkflowNode): Promise<DampLabService> {
    if (node.service instanceof mongoose.Types.ObjectId) {
      const service = await this.damplabServices.findOne(node.service.toString());
      if (service !== null) {
        return service;
      } else {
        throw new Error(`Could not find service with ID ${node.service}`);
      }
    } else {
      return node.service as DampLabService;
    }
  }
}
