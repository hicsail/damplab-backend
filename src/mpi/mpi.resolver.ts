import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Injectable, UseGuards } from '@nestjs/common';
import { MPIService } from './mpi.service';
import { Sequence, ScreeningBatch } from './models/mpi.model';
import { BatchScreeningInput, BatchCreateSequencesInput } from './dtos/mpi.dto';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { normalizeScreeningBatchForGraphql } from './mpi-screening-batch.graphql.util';

@Injectable()
@Resolver(() => Sequence)
export class MPIResolver {
  constructor(private readonly mpiService: MPIService) {}

  @Query(() => [ScreeningBatch])
  @UseGuards(AuthRolesGuard)
  async orgScreenings(): Promise<ScreeningBatch[]> {
    const batches = await this.mpiService.getOrgScreenings();
    return batches.map((b) => normalizeScreeningBatchForGraphql(b as unknown as Record<string, unknown>));
  }

  @Mutation(() => [Sequence])
  @UseGuards(AuthRolesGuard)
  async createSequencesBatch(@Args('input') input: BatchCreateSequencesInput, @CurrentUser() user: User): Promise<Sequence[]> {
    return this.mpiService.createSequencesBatch(input.sequences, user.sub);
  }

  @Mutation(() => ScreeningBatch)
  @UseGuards(AuthRolesGuard)
  async screenSequencesBatch(@Args('input') input: BatchScreeningInput, @CurrentUser() user: User): Promise<ScreeningBatch> {
    const batch = await this.mpiService.screenSequencesBatch(input, user.sub);
    return normalizeScreeningBatchForGraphql(batch as unknown as Record<string, unknown>);
  }
}
