import { ResolveField, Resolver, Parent } from '@nestjs/graphql';
import { WorkflowEdge } from '../models/edge.model';
import { WorkflowNode } from '../models/node.model';
import { WorkflowNodeService } from '../services/node.service';

@Resolver(() => WorkflowEdge)
export class WorkflowEdgeResolver {
  constructor(private readonly nodeService: WorkflowNodeService) {}

  @ResolveField()
  async source(@Parent() edge: WorkflowEdge): Promise<WorkflowNode> {
    const node = await this.nodeService.getByID(edge.source.toString());
    if (!node) {
      throw new Error(`Could not find node with ID ${edge.source}`);
    }
    return node;
  }

  @ResolveField()
  async destination(@Parent() edge: WorkflowEdge): Promise<WorkflowNode> {
    const node = await this.nodeService.getByID(edge.destination.toString());
    if (!node) {
      throw new Error(`Could not find node with ID ${edge.destination}`);
    }
    return node;
  }
}
