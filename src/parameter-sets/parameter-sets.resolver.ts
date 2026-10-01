import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { DampLabService } from '../services/models/damplab-service.model';
import { ParameterSet } from './parameter-set.model';
import { ParameterSetsService } from './parameter-sets.service';
import { CreateParameterSet, ParameterSetChange } from './dtos/parameter-set.input';

@Resolver(() => ParameterSet)
@UseGuards(AuthRolesGuard)
export class ParameterSetsResolver {
  // Named `parameterSetsService`, not `parameterSets` — the latter would clash
  // with the `parameterSets` query method below (TS2300) and shadow it.
  constructor(private readonly parameterSetsService: ParameterSetsService) {}

  @Query(() => [ParameterSet])
  @RequirePermission(Permission.CatalogEditorRead)
  parameterSets(): Promise<ParameterSet[]> {
    return this.parameterSetsService.findAll();
  }

  @Query(() => ParameterSet, { nullable: true })
  @RequirePermission(Permission.CatalogEditorRead)
  parameterSet(@Args('id', { type: () => ID }) id: string): Promise<ParameterSet | null> {
    return this.parameterSetsService.findById(id);
  }

  @Mutation(() => ParameterSet)
  @RequirePermission(Permission.CatalogEditorWrite)
  createParameterSet(@Args('parameterSet') parameterSet: CreateParameterSet): Promise<ParameterSet> {
    return this.parameterSetsService.create(parameterSet);
  }

  @Mutation(() => ParameterSet)
  @RequirePermission(Permission.CatalogEditorWrite)
  updateParameterSet(@Args('id', { type: () => ID }) id: string, @Args('changes') changes: ParameterSetChange): Promise<ParameterSet> {
    return this.parameterSetsService.update(id, changes);
  }

  @Mutation(() => Boolean)
  @RequirePermission(Permission.CatalogEditorWrite)
  deleteParameterSet(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.parameterSetsService.delete(id);
  }

  @ResolveField(() => [DampLabService], { description: 'Non-deleted operations referencing this set.' })
  usedBy(@Parent() set: ParameterSet): Promise<DampLabService[]> {
    return this.parameterSetsService.usedBy(String(set._id));
  }
}
