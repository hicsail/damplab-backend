import { WorkflowNode } from '../models/node.model';
import { Parent, Resolver, ResolveField } from '@nestjs/graphql';
import { DampLabServices } from '../../services/damplab-services.services';
import { DampLabService } from '../../services/models/damplab-service.model';
import mongoose from 'mongoose';

@Resolver(() => WorkflowNode)
export class WorkflowNodeResolver {
  constructor(private readonly damplabServices: DampLabServices) {}

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
