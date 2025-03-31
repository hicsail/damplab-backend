import { Args, Mutation, Query, Resolver, Subscription, Context } from '@nestjs/graphql';
import { Injectable } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { MPIService } from './mpi.service';
import { Sequence } from './models/mpi.model';
import { ScreeningResult } from './models/mpi.model';
import { CreateSequenceInput, ScreeningInput, BatchScreeningInput } from './dtos/mpi.dto';
import { Region } from './types';
import { JwtService } from '@nestjs/jwt';
import { UserInfo, AuthResponse, LoginStatus } from './models/auth.model';

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
  private pubSub: PubSub;

  constructor(private readonly mpiService: MPIService, private readonly jwtService: JwtService) {
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
      return this.mpiService.getUserScreenings(payload.userId);
    } catch (error) {
      throw new Error('Invalid token');
    }
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
    },
    resolve: (payload: { screeningStatus: ScreeningStatusPayload }) => {
      if (!payload?.screeningStatus) {
        return null;
      }
      return payload.screeningStatus;
    }
  })
  screeningStatus(@Args('sequenceId') sequenceId: string): AsyncIterator<unknown> {
    return this.pubSub.asyncIterator('screeningStatus');
  }

  @Query(() => LoginStatus)
  async isLoggedIn(@Context() context: Context): Promise<LoginStatus> {
    const authHeader = context.req.headers.authorization;
    if (!authHeader) {
      return { loggedIn: false };
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return { loggedIn: false };
    }

    try {
      const payload = this.jwtService.verify(token);
      const userData = await this.mpiService.getUserData(payload.userId);
      return {
        loggedIn: true,
        userInfo: userData
      };
    } catch (error) {
      return { loggedIn: false };
    }
  }

  @Query(() => UserInfo)
  async getUserInfo(@Context() context: Context): Promise<UserInfo> {
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
      return await this.mpiService.getUserData(payload.userId);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  @Mutation(() => AuthResponse)
  async exchangeCodeForToken(@Args('code') code: string, @Args('state') state: string): Promise<AuthResponse> {
    return this.mpiService.exchangeCodeForToken(code, state);
  }

  @Mutation(() => String)
  async logout(@Context() context: Context): Promise<string> {
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
      return await this.mpiService.logout(payload.userId);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }
}
