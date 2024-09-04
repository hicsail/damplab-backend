import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Category, CategorySchema } from './category.model';
import { CategoryService } from './categories.service';
import { CategoryResolver } from './categories.resolver';
import { DampLabServicesModule } from '../services/damplab-services.module';
import { CategoryPipe } from './categories.pipe';
import { CategoryUpdatePipe } from './update.pipe';

@Module({
  imports: [MongooseModule.forFeature([{ name: Category.name, schema: CategorySchema }]), DampLabServicesModule],
  providers: [CategoryService, CategoryResolver, CategoryPipe, CategoryUpdatePipe]
})
export class CategoriesModule {}
