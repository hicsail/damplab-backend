import { Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { DampLabServices } from '../services/damplab-services.services';
import { DampLabService } from '../services/models/damplab-service.model';
import { Bundle } from './bundles.model';
import { BundlesService } from './bundles.service';

@Resolver(() => Bundle)
export class BundlesResolver {
  constructor(private readonly bundlesService: BundlesService, private readonly dampLabServices: DampLabServices) {}

  @Query(() => [Bundle])
  async bundles(): Promise<Bundle[]> {
    return this.bundlesService.findAll();
  }

  @ResolveField()
  async services(@Parent() bundle: Bundle): Promise<DampLabService[]> {
    return this.dampLabServices.findByIds(bundle.services);
  }
}
