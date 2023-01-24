import { WorkflowNode } from '../models/node.model';
import { Parent, Resolver, ResolveField } from '@nestjs/graphql';
import { DampLabServices } from '../../services/damplab-services.services';
import { DampLabService } from '../../services/models/damplab-service.model';

@Resolver(() => WorkflowNode)
export class WorkflowNodeResolver {
  constructor(private readonly damplabServices: DampLabServices) {}

  @ResolveField()
  async service(@Parent() node: WorkflowNode): Promise<DampLabService> {
    console.log(node);
    if (typeof node.service === 'string') {
      const service = await this.damplabServices.findOne(node.service);
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

