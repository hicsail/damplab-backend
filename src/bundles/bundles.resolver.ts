import { UseGuards } from '@nestjs/common';
import { Parent, Query, ResolveField, Resolver, Args, Mutation, ID } from '@nestjs/graphql';
import { DampLabServices } from '../services/damplab-services.services';
import { DampLabService } from '../services/models/damplab-service.model';
import { Bundle } from './bundles.model';
import { BundlesService } from './bundles.service';
import { BundlesPipe } from './bundles.pipe';
import { BundleChange } from './dtos/update.dto';
import { BundleUpdatePipe } from './update.pipe';

import { AuthRolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/roles.enum';

@Resolver(() => Bundle)
@UseGuards(AuthRolesGuard)
export class BundlesResolver {
  constructor(private readonly bundlesService: BundlesService, private readonly dampLabServices: DampLabServices) {}

  @Query(() => [Bundle])
  async bundles(): Promise<Bundle[]> {
    return this.bundlesService.findAll();
  }

  @Mutation(() => Bundle)
  @Roles(Role.DamplabStaff)
  async updateBundle(@Args('bundle', { type: () => ID }, BundlesPipe) bundle: Bundle, @Args('changes', { type: () => BundleChange }, BundleUpdatePipe) changes: BundleChange): Promise<Bundle> {
    return this.bundlesService.update(bundle, changes);
  }

  @ResolveField()
  async services(@Parent() bundle: Bundle): Promise<DampLabService[]> {
    return this.dampLabServices.findByIds(bundle.services);
  }
}
