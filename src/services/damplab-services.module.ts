import { Module } from '@nestjs/common';
import { DampLabServicesResolver } from './damplab-services.resolver';
import { DampLabServices } from './damplab-services.services';

@Module({
  providers: [DampLabServicesResolver, DampLabServices]
})
export class DampLabServicesModule {}
