import { ResolveField, Resolver, Parent } from '@nestjs/graphql';
import { BundleEdge } from '../models/edge.model';
import { BundleNode } from '../models/node.model';
import { BundleNodeService } from '../services/node.service';

@Resolver(() => BundleEdge)
export class BundleEdgeResolver {
  constructor(private readonly nodeService: BundleNodeService) {}

  @ResolveField()
  async source(@Parent() edge: BundleEdge): Promise<BundleNode> {
    const node = await this.nodeService.getByID(edge.source.toString());
    if (!node) {
      throw new Error(`Could not find node with ID ${edge.source}`);
    }
    return node;
  }

  @ResolveField()
  async target(@Parent() edge: BundleEdge): Promise<BundleNode> {
    const node = await this.nodeService.getByID(edge.target.toString());
    if (!node) {
      throw new Error(`Could not find node with ID ${edge.target}`);
    }
    return node;
  }
}
