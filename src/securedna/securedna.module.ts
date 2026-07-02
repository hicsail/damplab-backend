import { Module } from '@nestjs/common';
import { SecureDnaService } from './securedna.service';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SecureDnaResolver } from './securedna.resolver';
import { SequenceSchema } from './models/sequence.schema';
import { ScreeningBatchSchema } from './models/screening-batch.schema';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: 'Sequence', schema: SequenceSchema },
      { name: 'ScreeningBatch', schema: ScreeningBatchSchema }
    ])
  ],
  providers: [SecureDnaService, SecureDnaResolver],
  exports: [SecureDnaService]
})
export class SecureDnaModule {}
