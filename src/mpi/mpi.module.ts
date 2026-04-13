import { Module } from '@nestjs/common';
import { MPIService } from './mpi.service';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MPIResolver } from './mpi.resolver';
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
  providers: [MPIService, MPIResolver],
  exports: [MPIService]
})
export class MPIModule {}
