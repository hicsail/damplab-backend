import { Args, Mutation, Query, Resolver, Context } from '@nestjs/graphql';
import { Injectable } from '@nestjs/common';
import { MPIService } from './mpi.service';
import { Sequence } from './models/mpi.model';
import { ScreeningResult } from './models/mpi.model';
import { CreateSequenceInput, ScreeningInput, BatchScreeningInput } from './dtos/mpi.dto';
import { Region } from './types';
import { JwtService } from '@nestjs/jwt';

interface Context {
  req: {
    headers: {
      authorization?: string;
    };
  };
}

@Injectable()
@Resolver(() => Sequence)
export class MPIResolver {
  constructor(private readonly mpiService: MPIService, private readonly jwtService: JwtService) {}

  @Query(() => [Sequence])
  async sequences(): Promise<Sequence[]> {
    return this.mpiService.getSequences();
  }

  @Query(() => Sequence, { nullable: true })
  async sequence(@Args('id') id: string): Promise<Sequence | null> {
    return this.mpiService.getSequence(id);
  }

  @Query(() => [ScreeningResult])
  async getUserScreenings(@Context() context: Context): Promise<ScreeningResult[]> {
    const authHeader = context.req.headers.authorization;
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new Error('No token provided');
    }

    try {
      const payload = this.jwtService.verify(token);
      const screenings = await this.mpiService.getUserScreenings(payload.userId);
      return screenings.map((screening) => ({
        ...screening,
        sequence: {
          ...screening.sequence,
          seq: screening.sequence.seq || '',
          type: screening.sequence.type || 'unknown',
          annotations: screening.sequence.annotations || [],
          userId: screening.sequence.userId || payload.userId,
          mpiId: screening.sequence.mpiId || ''
        }
      }));
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  @Mutation(() => Sequence)
  async createSequence(@Args('input') input: CreateSequenceInput, @Context() context: Context): Promise<Sequence> {
    const authHeader = context.req.headers.authorization;
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new Error('No token provided');
    }

    try {
      const payload = this.jwtService.verify(token);
      return this.mpiService.createSequence(input, payload.userId);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  @Mutation(() => ScreeningResult)
  async screenSequence(@Args('input') input: ScreeningInput, @Context() context: Context): Promise<ScreeningResult> {
    const authHeader = context.req.headers.authorization;
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new Error('No token provided');
    }

    try {
      const payload = this.jwtService.verify(token);
      return this.mpiService.screenSequence(input, payload.userId);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  @Mutation(() => [ScreeningResult])
  async screenSequencesBatch(@Args('input') input: BatchScreeningInput, @Context() context: Context): Promise<ScreeningResult[]> {
    const authHeader = context.req.headers.authorization;
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      throw new Error('No token provided');
    }

    try {
      const payload = this.jwtService.verify(token);
      return this.mpiService.screenSequencesBatch(input, payload.userId);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  @Mutation(() => Boolean)
  async deleteSequence(@Args('id') id: string): Promise<boolean> {
    return this.mpiService.deleteSequence(id);
  }
}
