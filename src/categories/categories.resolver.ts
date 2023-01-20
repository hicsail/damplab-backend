import { Query, Resolver } from '@nestjs/graphql';
import { Category } from './category.model';
import { CategoryService } from './categories.service';

@Resolver(() => Category)
export class CategoryResolver {
  constructor(private readonly categoryService: CategoryService) {}

  @Query(() => [Category])
  async categories(): Promise<Category[]> {
    return this.categoryService.findAll();
  }
}
