import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AclidService } from './aclid.service';

@Module({
  imports: [ConfigModule],
  providers: [AclidService],
  exports: [AclidService]
})
export class AclidModule {}
