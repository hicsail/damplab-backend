import { UseGuards } from '@nestjs/common';
import { Args, ID, InputType, Field, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UploadLog, FieldSnapshotInput, UploadEntityType } from './upload-log.model';
import { UploadLogService } from './upload-log.service';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { assertPermission } from '../auth/permissions/permissions';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { uploadLogWritePermission } from './upload-log.permissions';

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

  @Field(() => UploadEntityType, { defaultValue: UploadEntityType.INVENTORY })
  entityType: UploadEntityType;
}

@Resolver(() => UploadLog)
@UseGuards(AuthRolesGuard)
export class UploadLogResolver {
  constructor(private readonly uploadLogService: UploadLogService) {}

  @Query(() => [UploadLog], { description: 'All upload logs, newest first.' })
  @RequirePermission(Permission.CatalogEditorRead)
  async uploadLogs(): Promise<UploadLog[]> {
    return this.uploadLogService.findAll();
  }

  @Query(() => UploadLog, { nullable: true, description: 'A single upload log by ID.' })
  @RequirePermission(Permission.CatalogEditorRead)
  async uploadLog(@Args('id', { type: () => ID }) id: string): Promise<UploadLog | null> {
    return this.uploadLogService.findById(id);
  }

  @Mutation(() => UploadLog, {
    description: 'Record an upload log entry. Needs inventory:write for an INVENTORY log, catalog-editor:write for an OPERATION, PARAMETER_SET, BUNDLE or SOW_SECTION log.'
  })
  async createUploadLog(@Args('input', { type: () => CreateUploadLogInput }) input: CreateUploadLogInput, @CurrentUser() user: User): Promise<UploadLog> {
    const entityType = input.entityType ?? UploadEntityType.INVENTORY;
    assertPermission(user, uploadLogWritePermission(entityType));
    return this.uploadLogService.create({ ...input, entityType, uploadDate: new Date() });
  }
}
