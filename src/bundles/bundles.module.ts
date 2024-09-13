import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DampLabServicesModule } from '../services/damplab-services.module';
import { Bundle, BundleSchema } from './bundles.model';
import { BundlesResolver } from './bundles.resolver';
import { BundlesService } from './bundles.service';
import { BundleUpdatePipe } from './update.pipe';

@Module({
  imports: [MongooseModule.forFeature([{ name: Bundle.name, schema: BundleSchema }]), DampLabServicesModule],
  providers: [BundlesService, BundlesResolver, BundleUpdatePipe]
})
export class BundlesModule {}
