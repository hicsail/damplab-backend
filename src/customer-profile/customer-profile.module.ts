import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CustomerProfileEntity, CustomerProfileSchema } from './customer-profile.model';
import { CustomerProfileService } from './customer-profile.service';

/** Customer Management's own store (`customer_profiles`). Imports nothing but Mongoose, so any module may import it without a cycle. */
@Module({
  imports: [MongooseModule.forFeature([{ name: CustomerProfileEntity.name, schema: CustomerProfileSchema }])],
  providers: [CustomerProfileService],
  exports: [CustomerProfileService]
})
export class CustomerProfileModule {}
