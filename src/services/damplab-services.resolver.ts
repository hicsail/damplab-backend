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

  /**
   * Resolver which the `allowedConnections` field of the `DampLabService`
   * type. Allows for the recursive search on possible connections.
   */
  @ResolveField()
  allowedConnections(@Parent() service: DampLabService): Promise<DampLabService[]> {
    return this.dampLabServices.findByIds(service.allowedConnections);
  }
}
