import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Injectable, UseGuards } from '@nestjs/common';
import { MPIService } from './mpi.service';
import { Sequence, ScreeningBatch } from './models/mpi.model';
import { BatchScreeningInput, BatchCreateSequencesInput } from './dtos/mpi.dto';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';

function normalizeSequence(seq: Record<string, unknown>): Sequence {
  return {
    id: String(seq.id ?? ''),
    name: (seq.name as string) || '',
    type: (seq.type as Sequence['type']) || 'unknown',
    seq: (seq.seq as string) || '',
    annotations: (seq.annotations as Sequence['annotations']) || [],
    userId: (seq.userId as string) || '',
    mpiId: (seq.mpiId as string) || '',
    created_at: seq.created_at as Date,
    updated_at: seq.updated_at as Date
  };
}

function normalizeScreeningBatch(batch: Record<string, unknown>): ScreeningBatch {
  const sequences = ((batch.sequences as Record<string, unknown>[]) || []).map((slice) => ({
    ...slice,
    sequence: normalizeSequence((slice.sequence as Record<string, unknown>) || {})
  }));
  return {
    ...batch,
    sequences
  } as ScreeningBatch;
}

@Injectable()
@Resolver(() => Sequence)
export class MPIResolver {
  constructor(private readonly mpiService: MPIService) {}

  @Query(() => [ScreeningBatch])
  @UseGuards(AuthRolesGuard)
  async orgScreenings(): Promise<ScreeningBatch[]> {
    const batches = await this.mpiService.getOrgScreenings();
    return batches.map((b) => normalizeScreeningBatch(b as unknown as Record<string, unknown>));
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
    return normalizeScreeningBatch(batch as unknown as Record<string, unknown>);
  }
}
