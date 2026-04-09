import { Module } from '@nestjs/common';
import { MPIService } from './mpi.service';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MPIResolver } from './mpi.resolver';
import { SequenceSchema } from './models/sequence.schema';
import { ScreeningResultSchema } from './models/screening-result.schema';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: 'Sequence', schema: SequenceSchema },
      { name: 'ScreeningResult', schema: ScreeningResultSchema }
    ])
  ],
  providers: [MPIService, MPIResolver],
  exports: [MPIService]
})
export class MPIModule {}
