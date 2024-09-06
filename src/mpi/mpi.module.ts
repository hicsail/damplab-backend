import { Module } from '@nestjs/common';
import { MPIController } from './mpi.controller';
import { MPIService } from './mpi.service';

@Module({
  imports: [],
  controllers: [MPIController],
  providers: [MPIService]
})
export class MPIModule {}
