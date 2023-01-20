import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Category, CategorySchema } from './category.model';
import { CategoryService } from './categories.service';
import { CategoryResolver } from './categories.resolver';
import { DampLabServicesModule } from '../services/damplab-services.module';


@Module({
  imports: [MongooseModule.forFeature([{ name: Category.name, schema: CategorySchema }]), DampLabServicesModule],
  providers: [CategoryService, CategoryResolver],
})
export class CategoriesModule {}
