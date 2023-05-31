import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DampLabService, DampLabServiceSchema } from '../services/models/damplab-service.model';
import { ResetResolver } from './reset.resolver';
import { ResetService } from './reset.service';
import { Category, CategorySchema } from '../categories/category.model';
import { Bundle, BundleSchema } from '../bundles/bundles.model';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DampLabService.name, schema: DampLabServiceSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Bundle.name, schema: BundleSchema }
    ])
  ],
  providers: [ResetResolver, ResetService]
})
export class ResetModule {}
