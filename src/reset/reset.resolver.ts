import { Resolver, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthRolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/roles.enum';
import { CategoryInput } from './dtos/category.dto';
import { ServiceInput } from './dtos/service.dto';
import { BundleInput } from './dtos/bundle.dto';
import { ResetService } from './reset.service';

/**
 * Both mutations here drop the entire database (`loadData` clears before loading).
 *
 * They carried no guard and no env gate at all, while `ResetModule` was registered
 * unconditionally — two unauthenticated database-drop mutations reachable by anyone
 * who could reach /graphql. There is no global guard in this app, so an undecorated
 * resolver has no auth whatsoever.
 *
 * Now double-gated: the module only registers when ENABLE_RESET_MODULE=true (see
 * `app.module.ts`), and staff auth is required even then.
 */
@Resolver()
@UseGuards(AuthRolesGuard)
@Roles(Role.DamplabStaff)
export class ResetResolver {
  constructor(private readonly resetService: ResetService) {}

  @Mutation(() => Boolean, { description: 'Dev only: drop the database. Requires ENABLE_RESET_MODULE=true and damplab-staff.' })
  async clearDatabase(): Promise<boolean> {
    await this.resetService.clearDatabase();
    return true;
  }

  @Mutation(() => Boolean, { description: 'Dev only: drop the database, then load services, categories, and bundles. Requires ENABLE_RESET_MODULE=true and damplab-staff.' })
  async loadData(
    @Args('services', { type: () => [ServiceInput] }) services: ServiceInput[],
    @Args('categories', { type: () => [CategoryInput] }) categories: CategoryInput[],
    @Args('bundles', { type: () => [BundleInput] }) bundles: BundleInput[]
  ): Promise<boolean> {
    await this.resetService.loadData(services, categories, bundles);
    return true;
  }
}
