import { Parent, Query, ResolveField, Resolver, Args, Mutation, ID } from '@nestjs/graphql';
import { DampLabServices } from '../services/damplab-services.services';
import { DampLabService } from '../services/models/damplab-service.model';
import { Bundle } from './models/bundle.model';
import { BundlesService } from './bundles.service';
import { BundleNodeService } from './services/node.service';
import { BundleEdgeService } from './services/edge.service';
import { CreateBundleInput } from './dtos/create.dto';
import { BundleChange } from './dtos/update.dto';
import { BundlesPipe } from './bundles.pipe';
import { BundleUpdatePipe } from './update.pipe';

@Resolver(() => Bundle)
export class BundlesResolver {
  constructor(
    private readonly bundlesService: BundlesService,
    private readonly dampLabServices: DampLabServices,
    private readonly nodeService: BundleNodeService,
    private readonly edgeService: BundleEdgeService
  ) {}

  @Query(() => [Bundle])
  async bundles(): Promise<Bundle[]> {
    return this.bundlesService.findAll();
  }

  @Mutation(() => Bundle)
  async createBundle(@Args('input') input: CreateBundleInput): Promise<Bundle> {
    return this.bundlesService.create(input);
  }

  @Mutation(() => Bundle)
  async updateBundle(
    @Args('bundle', { type: () => ID }, BundlesPipe) bundle: Bundle,
    @Args('changes', { type: () => BundleChange }, BundleUpdatePipe) changes: BundleChange
  ): Promise<Bundle> {
    return this.bundlesService.update(bundle, changes);
  }

  @Mutation(() => Boolean)
  async deleteBundle(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.bundlesService.delete(id);
  }

  @ResolveField()
  async nodes(@Parent() bundle: Bundle) {
    return this.nodeService.getByIDs(bundle.nodes.map((node) => node._id.toString()));
  }

  @ResolveField()
  async edges(@Parent() bundle: Bundle) {
    return this.edgeService.getByIDs(bundle.edges.map((edge) => edge._id.toString()));
  }
}
