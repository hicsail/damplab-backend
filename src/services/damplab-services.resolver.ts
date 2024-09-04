import { Resolver, Query, ResolveField, Parent, ID, Args, Mutation } from '@nestjs/graphql';
import { DampLabServicePipe } from './damplab-services.pipe';
import { DampLabServices } from './damplab-services.services';
import { ServiceChange } from './dtos/update.dto';
import { DampLabService } from './models/damplab-service.model';

@Resolver(() => DampLabService)
export class DampLabServicesResolver {
  constructor(private readonly dampLabServices: DampLabServices) {}

  @Query(() => [DampLabService])
  async services(): Promise<DampLabService[]> {
    return this.dampLabServices.findAll();
  }

  @Mutation(() => DampLabService)
  async updateService(
    @Args('service', { type: () => ID }, DampLabServicePipe) service: DampLabService,
    @Args('changes') changes: ServiceChange): Promise<DampLabService> {
    return this.dampLabServices.update(service, changes);
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
