import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SecureDnaService } from './securedna.service';
import { ScreeningBatchSchema } from './models/screening-batch.schema';

@Module({
  imports: [ConfigModule, MongooseModule.forFeature([{ name: 'ScreeningBatch', schema: ScreeningBatchSchema }])],
  providers: [SecureDnaService],
  exports: [SecureDnaService]
})
export class SecureDnaModule {}
