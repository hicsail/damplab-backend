import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Injectable, UseGuards } from '@nestjs/common';
import { MPIService } from './mpi.service';
import { Sequence } from './models/mpi.model';
import { ScreeningResult } from './models/mpi.model';
import { BatchScreeningInput, BatchCreateSequencesInput } from './dtos/mpi.dto';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';

@Injectable()
@Resolver(() => Sequence)
export class MPIResolver {
  constructor(private readonly mpiService: MPIService) {}

  @Query(() => [ScreeningResult])
  @UseGuards(AuthRolesGuard)
  async orgScreenings(): Promise<ScreeningResult[]> {
    const screenings = await this.mpiService.getOrgScreenings();
    return screenings.map((screening) => ({
      ...screening,
      sequence: {
        ...screening.sequence,
        seq: screening.sequence.seq || '',
        type: screening.sequence.type || 'unknown',
        annotations: screening.sequence.annotations || [],
        userId: screening.sequence.userId || '',
        mpiId: screening.sequence.mpiId || ''
      }
    }));
  }

  @Mutation(() => [Sequence])
  @UseGuards(AuthRolesGuard)
  async createSequencesBatch(
    @Args('input') input: BatchCreateSequencesInput,
    @CurrentUser() user: User
  ): Promise<Sequence[]> {
    return this.mpiService.createSequencesBatch(input.sequences, user.sub);
  }

  @Mutation(() => [ScreeningResult])
  @UseGuards(AuthRolesGuard)
  async screenSequencesBatch(@Args('input') input: BatchScreeningInput, @CurrentUser() user: User): Promise<ScreeningResult[]> {
    return this.mpiService.screenSequencesBatch(input, user.sub);
  }
}
