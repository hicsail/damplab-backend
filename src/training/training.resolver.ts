import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Guide } from './guide.model';
import { TrainingService } from './training.service';
import { CreateGuideInput, UpdateGuideInput } from './dto/guide.input';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { hasPermission } from '../auth/permissions/permissions';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';

@Resolver(() => Guide)
@UseGuards(AuthRolesGuard)
export class TrainingResolver {
  constructor(private readonly trainingService: TrainingService) {}

  /**
   * The Learning Hub list. `training:read` is baseline, so everyone gets it —
   * what differs is whether **drafts** are included, and that is decided from the
   * caller's permission rather than from an argument they could set.
   */
  @Query(() => [Guide], { description: 'Learning Hub guides. Drafts are included only for a training:write holder.' })
  @RequirePermission(Permission.TrainingRead)
  async guides(@CurrentUser() user: User): Promise<Guide[]> {
    return this.trainingService.findAll(hasPermission(user, Permission.TrainingWrite));
  }

  @Query(() => Guide, { nullable: true, description: 'One guide by its URL slug.' })
  @RequirePermission(Permission.TrainingRead)
  async guideBySlug(@Args('slug') slug: string, @CurrentUser() user: User): Promise<Guide | null> {
    return this.trainingService.findBySlug(slug, hasPermission(user, Permission.TrainingWrite));
  }

  @Mutation(() => Guide)
  @RequirePermission(Permission.TrainingWrite)
  async createGuide(@Args('input') input: CreateGuideInput, @CurrentUser() user: User): Promise<Guide> {
    return this.trainingService.create(input, user?.email || user?.preferred_username);
  }

  @Mutation(() => Guide)
  @RequirePermission(Permission.TrainingWrite)
  async updateGuide(@Args('input') input: UpdateGuideInput, @CurrentUser() user: User): Promise<Guide> {
    return this.trainingService.update(input, user?.email || user?.preferred_username);
  }

  @Mutation(() => Boolean)
  @RequirePermission(Permission.TrainingWrite)
  async deleteGuide(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.trainingService.delete(id);
  }
}
