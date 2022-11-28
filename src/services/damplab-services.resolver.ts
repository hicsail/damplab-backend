import { Resolver, Query, ResolveField, Parent } from '@nestjs/graphql';
import { DampLabServices } from './damplab-services.services';
import { DampLabService } from './models/damplab-service.model';

@Resolver(() => DampLabService)
export class DampLabServicesResolver {
  constructor(private readonly dampLabServices: DampLabServices) {}

  @Query(() => [DampLabService])
  async services(): Promise<DampLabService[]> {
    return this.dampLabServices.findAll();
  }

  @ResolveField()
  allowedConnections(@Parent() service: DampLabService): Promise<DampLabService[]> {
    return this.dampLabServices.findByIds(service.allowedConnections);
  }
}
