import { Args, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { Injectable } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { MPIService } from './mpi.service';
import { Sequence } from './models/mpi.model';
import { ScreeningResult } from './models/mpi.model';
import { CreateSequenceInput, ScreeningInput, BatchScreeningInput } from './dtos/mpi.dto';
import { Region } from './types';

interface ScreeningStatusPayload {
  id: string;
  status: string;
  sequence: Sequence;
  region: Region;
  threats: Array<{
    name: string;
    description: string;
    is_wild_type: boolean;
    references: string[];
  }>;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
@Resolver(() => Sequence)
export class MPIResolver {
  private pubSub: PubSub;

  constructor(private readonly mpiService: MPIService) {
    this.pubSub = new PubSub();
  }

  @Query(() => [Sequence])
  async sequences(): Promise<Sequence[]> {
    return this.mpiService.getSequences();
  }

  @Query(() => Sequence, { nullable: true })
  async sequence(@Args('id') id: string): Promise<Sequence | null> {
    return this.mpiService.getSequence(id);
  }

  @Mutation(() => Sequence)
  async createSequence(@Args('input') input: CreateSequenceInput): Promise<Sequence> {
    return this.mpiService.createSequence(input);
  }

  @Mutation(() => ScreeningResult)
  async screenSequence(@Args('input') input: ScreeningInput): Promise<ScreeningResult> {
    const result = await this.mpiService.screenSequence(input);
    await this.pubSub.publish('screeningStatus', {
      screeningStatus: {
        id: result.id,
        status: result.status,
        sequence: result.sequence,
        region: result.region,
        threats: result.threats,
        created_at: result.created_at,
        updated_at: result.updated_at
      }
    });
    return result;
  }

  @Mutation(() => [ScreeningResult])
  async screenSequencesBatch(@Args('input') input: BatchScreeningInput): Promise<ScreeningResult[]> {
    const results = await this.mpiService.screenSequencesBatch(input);
    for (const result of results) {
      await this.pubSub.publish('screeningStatus', {
        screeningStatus: {
          id: result.id,
          status: result.status,
          sequence: result.sequence,
          region: result.region,
          threats: result.threats,
          created_at: result.created_at,
          updated_at: result.updated_at
        }
      });
    }
    return results;
  }

  @Mutation(() => Boolean)
  async deleteSequence(@Args('id') id: string): Promise<boolean> {
    return this.mpiService.deleteSequence(id);
  }

  @Subscription(() => ScreeningResult, {
    filter: (payload: { screeningStatus: ScreeningStatusPayload }, variables: { sequenceId: string }) => {
      return payload.screeningStatus.sequence.id === variables.sequenceId;
    }
  })
  screeningStatus(@Args('sequenceId') sequenceId: string): AsyncIterator<unknown> {
    return this.pubSub.asyncIterator('screeningStatus');
  }
}
