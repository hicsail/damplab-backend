import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CreateServicePipe } from './create.pipe';
import { DampLabServicePipe } from './damplab-services.pipe';
import { DampLabServicesResolver } from './damplab-services.resolver';
import { DampLabServices } from './damplab-services.services';
import { DampLabService, DampLabServiceSchema } from './models/damplab-service.model';
import { ServiceUpdatePipe } from './update.pipe';

@Module({
  imports: [MongooseModule.forFeature([{ name: DampLabService.name, schema: DampLabServiceSchema }])],
  providers: [DampLabServicesResolver, DampLabServices, DampLabServicePipe, ServiceUpdatePipe, CreateServicePipe],
  exports: [DampLabServices, DampLabServicePipe]
})
export class DampLabServicesModule {}
