import { Module } from '@nestjs/common';
import { ClickUpService } from './clickup.service';
import { ClickUpResolver } from './clickup.resolver';

@Module({
  providers: [ClickUpService, ClickUpResolver],
  exports: [ClickUpService]
})
export class ClickUpModule {}
