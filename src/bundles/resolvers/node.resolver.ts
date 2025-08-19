import { BundleNode } from '../models/node.model';
import { Parent, Resolver, ResolveField, Mutation, ID, Args } from '@nestjs/graphql';
import { DampLabServices } from '../../services/damplab-services.services';
import { DampLabService } from '../../services/models/damplab-service.model';
import mongoose from 'mongoose';
import { BundleNodePipe } from '../node.pipe';
import { BundleNodeService } from '../services/node.service';

@Resolver(() => BundleNode)
export class BundleNodeResolver {
  constructor(private readonly damplabServices: DampLabServices, private readonly nodeService: BundleNodeService) {}

  @ResolveField()
  async service(@Parent() node: BundleNode): Promise<DampLabService> {
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
