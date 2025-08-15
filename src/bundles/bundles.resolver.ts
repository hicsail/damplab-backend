import { Parent, Query, ResolveField, Resolver, Args, Mutation, ID } from '@nestjs/graphql';
import { DampLabServices } from '../services/damplab-services.services';
import { DampLabService } from '../services/models/damplab-service.model';
import { Bundle } from './bundles.model';
import { BundlesService } from './bundles.service';
import { BundlesPipe } from './bundles.pipe';
import { BundleChange } from './dtos/update.dto';
import { CreateBundleInput } from './dtos/create.dto';
import { BundleUpdatePipe } from './update.pipe';

@Resolver(() => Bundle)
export class BundlesResolver {
  constructor(private readonly bundlesService: BundlesService, private readonly dampLabServices: DampLabServices) {}

  @Query(() => [Bundle])
  async bundles(): Promise<Bundle[]> {
    return this.bundlesService.findAll();
  }

  @Mutation(() => Bundle)
  async createBundle(@Args('input') input: CreateBundleInput): Promise<Bundle> {
    return this.bundlesService.create(input);
  }

  @Mutation(() => Boolean)
  async deleteBundle(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return await this.bundlesService.delete(id);
  }

  @Mutation(() => Bundle)
  async updateBundle(@Args('bundle', { type: () => ID }, BundlesPipe) bundle: Bundle, @Args('changes', { type: () => BundleChange }, BundleUpdatePipe) changes: BundleChange): Promise<Bundle> {
    return this.bundlesService.update(bundle, changes);
  }

  @ResolveField()
  async services(@Parent() bundle: Bundle): Promise<DampLabService[]> {
    return this.dampLabServices.findByIds(bundle.services);
  }
}
