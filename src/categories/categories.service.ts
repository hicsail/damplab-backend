import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Category, CategoryDocument } from './category.model';
import { Model } from 'mongoose';
import { CategoryChange } from './dtos/update.dto';

@Injectable()
export class CategoryService {
  constructor(@InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>) {}

  async findAll(): Promise<Category[]> {
    return this.categoryModel.find().exec();
  }

  async find(id: string): Promise<Category | null> {
    return this.categoryModel.findById(id);
  }

  async update(category: Category, change: CategoryChange): Promise<Category> {
    await this.categoryModel.updateOne({ _id: category._id }, change);
    return (await this.find(category._id))!;
  }
}
