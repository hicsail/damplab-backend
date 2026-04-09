import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Injectable, UseGuards } from '@nestjs/common';
import { MPIService } from './mpi.service';
import { Sequence } from './models/mpi.model';
import { ScreeningResult } from './models/mpi.model';
import { CreateSequenceInput, ScreeningInput, BatchScreeningInput } from './dtos/mpi.dto';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';

@Injectable()
@Resolver(() => Sequence)
export class MPIResolver {
  constructor(private readonly mpiService: MPIService) {}

  @Query(() => [Sequence])
  @UseGuards(AuthRolesGuard)
  async sequences(): Promise<Sequence[]> {
    return this.mpiService.getSequences();
  }

  @Query(() => Sequence, { nullable: true })
  @UseGuards(AuthRolesGuard)
  async sequence(@Args('id') id: string): Promise<Sequence | null> {
    return this.mpiService.getSequence(id);
  }

  @Query(() => [ScreeningResult])
  @UseGuards(AuthRolesGuard)
  async getUserScreenings(): Promise<ScreeningResult[]> {
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

  @Mutation(() => Sequence)
  @UseGuards(AuthRolesGuard)
  async createSequence(@Args('input') input: CreateSequenceInput, @CurrentUser() user: User): Promise<Sequence> {
    return this.mpiService.createSequence(input, user.sub);
  }

  @Mutation(() => ScreeningResult)
  @UseGuards(AuthRolesGuard)
  async screenSequence(@Args('input') input: ScreeningInput, @CurrentUser() user: User): Promise<ScreeningResult> {
    return this.mpiService.screenSequence(input, user.sub);
  }

  @Mutation(() => [ScreeningResult])
  @UseGuards(AuthRolesGuard)
  async screenSequencesBatch(@Args('input') input: BatchScreeningInput, @CurrentUser() user: User): Promise<ScreeningResult[]> {
    return this.mpiService.screenSequencesBatch(input, user.sub);
  }
}
