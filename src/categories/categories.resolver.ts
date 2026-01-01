import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, ResolveField, Resolver, ID } from '@nestjs/graphql';
import { Category } from './category.model';
import { CategoryService } from './categories.service';
import { DampLabServices } from '../services/damplab-services.services';
import { DampLabService } from '../services/models/damplab-service.model';
import { CategoryPipe } from './categories.pipe';
import { CategoryChange } from './dtos/update.dto';
import { CategoryUpdatePipe } from './update.pipe';
import { CreateCategory } from './dtos/create.dto';
import { CreateCategoryPipe } from './create.pipe';

import { AuthRolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/roles.enum';

@Resolver(() => Category)
@UseGuards(AuthRolesGuard)
export class CategoryResolver {
  constructor(private readonly categoryService: CategoryService, private readonly damplabServices: DampLabServices) {}

  @Query(() => [Category])
  async categories(): Promise<Category[]> {
    return this.categoryService.findAll();
  }

  @Mutation(() => Category)
  @Roles(Role.DamplabStaff)
  async updateCategory(
    @Args('category', { type: () => ID }, CategoryPipe) category: Category,
    @Args('changes', { type: () => CategoryChange }, CategoryUpdatePipe) changes: CategoryChange
  ): Promise<Category> {
    return this.categoryService.update(category, changes);
  }

  @Mutation(() => Boolean)
  @Roles(Role.DamplabStaff)
  async deleteCategory(@Args('category', { type: () => ID }, CategoryPipe) category: Category): Promise<boolean> {
    await this.categoryService.delete(category);
    return true;
  }

  @Mutation(() => Category)
  @Roles(Role.DamplabStaff)
  async createCategory(@Args('category', CreateCategoryPipe) category: CreateCategory): Promise<Category> {
    return this.categoryService.create(category);
  }

  /**
   * Resolver for the services field of the Category type
   */
  @ResolveField()
  async services(category: Category): Promise<DampLabService[]> {
    return this.damplabServices.findByIds(category.services);
  }
}
