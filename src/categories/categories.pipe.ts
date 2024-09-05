import { NotFoundException, Injectable, PipeTransform } from '@nestjs/common';
import { Category } from './category.model';
import { CategoryService } from './categories.service';

@Injectable()
export class CategoryPipe implements PipeTransform<string, Promise<Category>> {
  constructor(private readonly categoryService: CategoryService) {}

  async transform(value: string): Promise<Category> {
    try {
      const category = await this.categoryService.find(value);
      if (category) {
        return category;
      }
    } catch (e) {}

    throw new NotFoundException(`Category with id ${value} not found`);
  }
}
