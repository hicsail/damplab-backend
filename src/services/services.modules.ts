import { Module } from '@nestjs/common';
import { ServicesResolver } from './services.resolver';
import { Services } from './services.service';

@Module({
  providers: [ServicesResolver, Services],
})
export class ServicesModule {}
