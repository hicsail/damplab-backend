import { BadRequestException, ForbiddenException, NotFoundException, UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import mongoose from 'mongoose';
import { AuthRolesGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/user.decorator';
import { User } from '../../auth/user.interface';
import { RequirePermission } from '../../auth/permissions/permissions.decorator';
import { Permission } from '../../auth/permissions/permission.enum';
import { hasPermission } from '../../auth/permissions/permissions';
import { callerMayAccessJob } from '../../job/job-access';
import { DampLabServices } from '../../services/damplab-services.services';
import { DampLabService } from '../../services/models/damplab-service.model';
import { WorkflowNode } from '../models/node.model';
import { WorkflowNodeService } from '../services/node.service';
import { WorkflowParameterFilesService } from '../services/workflow-parameter-files.service';
import { getMultiValueParamIds } from '../utils/form-data.util';
import { ReplaceSampleSheetInput, SampleSheetTemplateUpload, SampleSheetTemplateUploadRequest } from '../dtos/sample-sheet.dto';
import { findSampleSheetParam, keyBelongsToUploader, SAMPLE_SHEET_TEMPLATE_KEY_PREFIX, sampleSheetReplaceBlockedReason, templateKeyOf } from '../utils/sample-sheet.util';

/**
 * Samples spreadsheets: the blank template on a catalog parameter, and
 * replacing the filled-in sheet on a submitted job.
 *
 * The initial upload needs nothing here — on the canvas a `sampleSheet` value
 * is uploaded at submission exactly like a `file` parameter, through
 * `createWorkflowParameterUploadUrls`. Replacement is its own narrow path rather
 * than a trip through `saveJobWorkflows`, because the workflow editor's gates
 * close once the lab takes the job back and a sample list must stay
 * correctable, by either side, while the job runs.
 */
@Resolver()
@UseGuards(AuthRolesGuard)
export class SampleSheetResolver {
  constructor(private readonly files: WorkflowParameterFilesService, private readonly dampLabServices: DampLabServices, private readonly nodeService: WorkflowNodeService) {}

  @Mutation(() => SampleSheetTemplateUpload, {
    description: 'Presign an upload for a blank samples-spreadsheet template. Store the returned key on the parameter as templateFile.key when saving the service.'
  })
  @RequirePermission(Permission.CatalogEditorWrite)
  async sampleSheetTemplateUploadUrl(@Args('input') input: SampleSheetTemplateUploadRequest, @CurrentUser() user: User): Promise<SampleSheetTemplateUpload> {
    const upload = await this.files.createPresignedUpload({
      userSub: user.sub ?? 'anonymous',
      clientToken: input.filename,
      filename: input.filename,
      contentType: input.contentType,
      size: input.size,
      keyPrefix: SAMPLE_SHEET_TEMPLATE_KEY_PREFIX
    });
    return { uploadUrl: upload.uploadUrl, key: upload.key };
  }

  /**
   * The key comes from the stored parameter, never from the caller: a presigned
   * URL is a bearer token, so this must not become "presign any key I name".
   */
  @Query(() => String, { nullable: true, description: 'A short-lived download URL for the blank template on a samples-spreadsheet parameter, or null when there is none.' })
  @RequirePermission(Permission.CatalogView)
  async sampleSheetTemplateUrl(@Args('serviceId', { type: () => ID }) serviceId: string, @Args('parameterId') parameterId: string): Promise<string | null> {
    const service = await this.dampLabServices.findOne(serviceId);
    const param = findSampleSheetParam(service?.parameters, parameterId);
    const key = templateKeyOf(param);
    if (!key) return null;
    return this.files.createPresignedDownload(key, param?.templateFile?.contentType);
  }

  /**
   * Scope is enforced here rather than by the gate, the same way the KYC
   * mutations do it: the baseline `jobs:view` lets every customer reach the
   * mutation, and `callerMayAccessJob` then admits only the job's owner, the
   * client named on a staff-submitted job, or anyone holding `jobs:view-all`.
   */
  @Mutation(() => WorkflowNode, {
    description:
      'Replace the samples spreadsheet on one operation of a job. Open to the job’s owner, its named client and staff, until the job is closed, cancelled or rejected. The key must be one createWorkflowParameterUploadUrls minted for the caller.'
  })
  @RequirePermission(Permission.JobsView)
  async replaceSampleSheet(@Args('input') input: ReplaceSampleSheetInput, @CurrentUser() user: User): Promise<WorkflowNode> {
    const node = await this.nodeService.getByID(input.nodeId);
    const job = node ? await this.nodeService.getJobForNode(input.nodeId) : null;
    if (!node || !job || String(job._id) !== String(input.jobId)) {
      throw new NotFoundException(`Operation ${input.nodeId} not found on job ${input.jobId}`);
    }
    if (!callerMayAccessJob(job, user, hasPermission(user, Permission.JobsViewAll))) {
      throw new ForbiddenException('You do not have permission to change this job');
    }
    const blocked = sampleSheetReplaceBlockedReason(job);
    if (blocked) throw new ForbiddenException(blocked);

    const service = node.service instanceof mongoose.Types.ObjectId ? await this.dampLabServices.findOne(node.service.toString()) : (node.service as DampLabService | null);
    const param = findSampleSheetParam(service?.parameters, input.parameterId);
    if (!param) {
      throw new BadRequestException(`Operation ${input.nodeId} has no samples spreadsheet parameter "${input.parameterId}"`);
    }
    if (!keyBelongsToUploader(input.file.key, user.sub)) {
      throw new ForbiddenException('That file was not uploaded by you. Upload it again and retry.');
    }
    if (!Number.isInteger(input.file.sampleCount) || input.file.sampleCount < 0) {
      throw new BadRequestException('sampleCount must be a non-negative whole number');
    }

    const value = globalThis.JSON.stringify({
      filename: input.file.filename,
      key: input.file.key,
      contentType: input.file.contentType,
      size: input.file.size,
      sampleCount: input.file.sampleCount,
      uploadedAt: new Date().toISOString()
    });
    return this.nodeService.setFormDataValue(node, input.parameterId, value, getMultiValueParamIds(service?.parameters));
  }
}
