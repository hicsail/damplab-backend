import { UseGuards } from '@nestjs/common';
import { Args, ID, InputType, Field, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UploadLog, FieldSnapshotInput } from './upload-log.model';
import { UploadLogService } from './upload-log.service';
import { AuthRolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/roles.enum';

@InputType()
export class CreateUploadLogInput {
  @Field()
  uploaderName: string;

  @Field({ nullable: true })
  uploaderSub?: string;

  @Field()
  fileName: string;

  @Field(() => Int)
  rowCount: number;

  @Field(() => Int)
  createdCount: number;

  @Field(() => Int)
  updatedCount: number;

  @Field(() => Int)
  skippedCount: number;

  @Field(() => Int)
  failedCount: number;

  @Field(() => [ID], { nullable: true })
  affectedItemIds?: string[];

  @Field(() => [FieldSnapshotInput], { nullable: true })
  fieldSnapshots?: FieldSnapshotInput[];
}

@Resolver(() => UploadLog)
@UseGuards(AuthRolesGuard)
export class UploadLogResolver {
  constructor(private readonly uploadLogService: UploadLogService) {}

  @Query(() => [UploadLog], { description: 'All upload logs, newest first.' })
  @Roles(Role.DamplabStaff)
  async uploadLogs(): Promise<UploadLog[]> {
    return this.uploadLogService.findAll();
  }

  @Query(() => UploadLog, { nullable: true, description: 'A single upload log by ID.' })
  @Roles(Role.DamplabStaff)
  async uploadLog(@Args('id', { type: () => ID }) id: string): Promise<UploadLog | null> {
    return this.uploadLogService.findById(id);
  }

  @Mutation(() => UploadLog, { description: 'Record an upload log entry.' })
  @Roles(Role.DamplabStaff)
  async createUploadLog(@Args('input', { type: () => CreateUploadLogInput }) input: CreateUploadLogInput): Promise<UploadLog> {
    return this.uploadLogService.create({
      ...input,
      uploadDate: new Date()
    });
  }
}
