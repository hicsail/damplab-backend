import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DampLabServicePipe } from './damplab-services.pipe';
import { DampLabServicesResolver } from './damplab-services.resolver';
import { DampLabServices } from './damplab-services.services';
import { DampLabService, DampLabServiceSchema } from './models/damplab-service.model';

@Module({
  imports: [MongooseModule.forFeature([{ name: DampLabService.name, schema: DampLabServiceSchema }])],
  providers: [DampLabServicesResolver, DampLabServices, DampLabServicePipe],
  exports: [DampLabServices, DampLabServicePipe]
})
export class DampLabServicesModule {}
