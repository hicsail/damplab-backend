import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { BadRequestException, NotFoundException, UseGuards } from '@nestjs/common';
import { TrainingResource } from './training-resource.model';
import { TrainingService } from './training.service';
import { TrainingFilesService } from './training-files.service';
import { TrainingFileUpload } from './dto/training-file-upload.dto';
import { CreateTrainingResourceInput, TrainingFileInput, TrainingFileUploadRequest, UpdateTrainingResourceInput } from './dto/training-resource.input';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { hasPermission } from '../auth/permissions/permissions';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { audiencesFor } from '../audience/audience';

@Resolver(() => TrainingResource)
@UseGuards(AuthRolesGuard)
export class TrainingResolver {
  constructor(private readonly trainingService: TrainingService, private readonly trainingFiles: TrainingFilesService) {}

  /**
   * The Learning Hub list.
   *
   * `training:read` is baseline, so everyone reaches the page — what differs is which
   * documents come back, and the server decides that from the caller's roles rather
   * than from anything they send. An administrator sees every document, because
   * reviewing what you published to another group is the point of the admin view.
   */
  @Query(() => [TrainingResource], { description: 'Learning Hub documents addressed to an audience the caller belongs to. A training:write holder sees all of them.' })
  @RequirePermission(Permission.TrainingRead)
  async trainingResources(@CurrentUser() user: User): Promise<TrainingResource[]> {
    if (hasPermission(user, Permission.TrainingWrite)) {
      return this.trainingService.findAll();
    }
    return this.trainingService.findForAudiences(audiencesFor(user));
  }

  /**
   * The download URL, minted per request.
   *
   * A `@ResolveField` rather than a stored column because a presigned URL is a bearer
   * token: persisting one would turn an audience-restricted document into a link that
   * works for anyone it is forwarded to, for as long as it lives.
   *
   * Safe without its own audience check *because* it can only be reached through a
   * resource the query above already filtered. `trainingResourceDownloadUrl` below is
   * the entry point that takes an id from the caller, and that one checks.
   */
  @ResolveField(() => String, { nullable: true })
  async downloadUrl(@Parent() resource: TrainingResource): Promise<string | null> {
    if (!resource.file?.key) return null;
    return this.trainingFiles.createPresignedDownload(resource.file.key, resource.file.filename);
  }

  /**
   * A fresh download URL for one document, by id.
   *
   * Exists because the URL in a list response expires; re-fetching one link is
   * cheaper than re-fetching the list. **This is the audience-checked entry point** —
   * the id comes from the caller, so the lookup is scoped to their audiences and a
   * document outside them is simply not found.
   */
  @Query(() => String, { nullable: true, description: 'A short-lived download URL for one document, if the caller is in its audience.' })
  @RequirePermission(Permission.TrainingRead)
  async trainingResourceDownloadUrl(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: User): Promise<string | null> {
    const resource = hasPermission(user, Permission.TrainingWrite) ? await this.trainingService.findById(id) : await this.trainingService.findOneForAudiences(id, audiencesFor(user));
    if (!resource?.file?.key) return null;
    return this.trainingFiles.createPresignedDownload(resource.file.key, resource.file.filename);
  }

  @Mutation(() => TrainingResource, { description: 'Create the record. Upload the file separately — see createTrainingFileUploadUrl.' })
  @RequirePermission(Permission.TrainingWrite)
  async createTrainingResource(@Args('input') input: CreateTrainingResourceInput, @CurrentUser() user: User): Promise<TrainingResource> {
    return this.trainingService.create(input, user?.email || user?.preferred_username);
  }

  @Mutation(() => TrainingResource, { description: 'Edit a document’s title, description or audience. The file is replaced by uploading a new one.' })
  @RequirePermission(Permission.TrainingWrite)
  async updateTrainingResource(@Args('input') input: UpdateTrainingResourceInput, @CurrentUser() user: User): Promise<TrainingResource> {
    return this.trainingService.update(input, user?.email || user?.preferred_username);
  }

  /**
   * A presigned PUT the browser uploads to directly.
   *
   * The record must exist first, so its id can namespace the S3 key. PDFs only, and
   * size-capped — checked in `TrainingFilesService` before the URL is minted, because
   * a presigned URL is permission to write and there is no second chance to refuse.
   */
  @Mutation(() => TrainingFileUpload, { description: 'Presigned upload URL for a Learning Hub PDF. Rejects non-PDFs and oversized files.' })
  @RequirePermission(Permission.TrainingWrite)
  async createTrainingFileUploadUrl(@Args('resourceId', { type: () => ID }) resourceId: string, @Args('file') file: TrainingFileUploadRequest): Promise<TrainingFileUpload> {
    const resource = await this.trainingService.findById(resourceId);
    if (!resource) throw new NotFoundException('Document not found');
    return this.trainingFiles.createPresignedUpload(resourceId, file.filename, file.contentType, file.size);
  }

  @Mutation(() => TrainingResource, { description: 'Record the uploaded file against its document, after the browser’s PUT succeeded.' })
  @RequirePermission(Permission.TrainingWrite)
  async attachTrainingFile(@Args('resourceId', { type: () => ID }) resourceId: string, @Args('file') file: TrainingFileInput, @CurrentUser() user: User): Promise<TrainingResource> {
    // Re-checked here as well as at presign time: the two are separate requests, and
    // this one is what decides whether a browser gets to serve the object back.
    this.trainingFiles.assertUploadable(file.contentType, file.size);
    // The key is client-supplied, and the bucket is shared with job, bug and workflow
    // attachments. Without this, a training:write holder could attach someone else's
    // object key and have `downloadUrl` presign a GET for it. No live escalation --
    // administrators can already reach those files -- but the whole point of this
    // service is that new code checks what the older three do not.
    if (!file.key.startsWith(`training/${resourceId}/`)) {
      throw new BadRequestException(`A Learning Hub file must live under training/${resourceId}/. Upload it through createTrainingFileUploadUrl.`);
    }
    return this.trainingService.attachFile(resourceId, file, user?.email || user?.preferred_username);
  }

  @Mutation(() => Boolean)
  @RequirePermission(Permission.TrainingWrite)
  async deleteTrainingResource(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.trainingService.delete(id);
  }
}
