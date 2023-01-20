import { Query, ResolveField, Resolver } from '@nestjs/graphql';
import { Category } from './category.model';
import { CategoryService } from './categories.service';
import { DampLabServices } from '../services/damplab-services.services';
import { DampLabService } from '../services/models/damplab-service.model';

@Resolver(() => Category)
export class CategoryResolver {
  constructor(private readonly categoryService: CategoryService, private readonly damplabServices: DampLabServices) {}

  @Query(() => [Category])
  async categories(): Promise<Category[]> {
    return this.categoryService.findAll();
  }

  /**
   * Resolver for the services field of the Category type
   */
  @ResolveField()
  async services(category: Category): Promise<DampLabService[]> {
    return this.damplabServices.findByIds(category.services);
  }
}
