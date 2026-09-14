import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Injectable, UseGuards } from '@nestjs/common';
import { SecureDnaService } from './securedna.service';
import { Sequence, ScreeningBatch } from './models/securedna-graphql.model';
import { BatchScreeningInput, BatchCreateSequencesInput } from './dtos/securedna.dto';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { normalizeScreeningBatchForGraphql } from './screening-batch-graphql.util';

@Injectable()
@Resolver(() => Sequence)
@UseGuards(AuthRolesGuard)
export class SecureDnaResolver {
  constructor(private readonly secureDnaService: SecureDnaService) {}

  @Query(() => [ScreeningBatch], {
    description: 'All SecureDNA screening batches that reference at least one stored sequence (newest first).'
  })
  @RequirePermission(Permission.JobsViewAll)
  async screeningBatches(): Promise<ScreeningBatch[]> {
    const batches = await this.secureDnaService.listScreeningBatches();
    return batches.map((b) => normalizeScreeningBatchForGraphql(b as unknown as Record<string, unknown>));
  }

  @Query(() => ScreeningBatch, {
    nullable: true,
    description: 'One stored screening batch by id, including job homology runs that the standalone list omits.'
  })
  @RequirePermission(Permission.JobsViewAll)
  async screeningBatch(@Args('id', { type: () => ID }) id: string): Promise<ScreeningBatch | null> {
    const batch = await this.secureDnaService.findBatchById(id);
    if (!batch) return null;
    return normalizeScreeningBatchForGraphql(batch);
  }

  @Mutation(() => [Sequence])
  @RequirePermission(Permission.JobsViewAll)
  async createSequencesBatch(@Args('input') input: BatchCreateSequencesInput, @CurrentUser() user: User): Promise<Sequence[]> {
    return this.secureDnaService.createSequencesBatch(input.sequences, user.sub);
  }

  @Mutation(() => ScreeningBatch)
  @RequirePermission(Permission.JobsViewAll)
  async screenSequencesBatch(@Args('input') input: BatchScreeningInput, @CurrentUser() user: User): Promise<ScreeningBatch> {
    const batch = await this.secureDnaService.screenSequencesBatch(input, user.sub);
    return normalizeScreeningBatchForGraphql(batch as unknown as Record<string, unknown>);
  }
}
