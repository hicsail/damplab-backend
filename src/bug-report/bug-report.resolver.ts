import { Args, ID, Mutation, Query, Resolver, ResolveField, Parent } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';
import { BugAttachment, BugReport } from './bug-report.model';
import {
  BugAttachmentInput,
  BugAttachmentUpload,
  BugAttachmentUploadRequest,
  BugReportsFilterInput,
  BugReportsResult,
  BugReportSummary,
  CreateBugReportInput
} from './bug-report.dto';
import { BugReportService } from './bug-report.service';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { BugReportAttachmentsService } from './bug-report-attachments.service';

@Resolver(() => BugReport)
@UseGuards(AuthRolesGuard)
export class BugReportResolver {
  private readonly logger = new Logger(BugReportResolver.name);

  constructor(
    private readonly bugReportService: BugReportService,
    private readonly bugReportAttachmentsService: BugReportAttachmentsService
  ) {}

  @Query(() => BugReportsResult, {
    description: 'List all bug reports, optionally filtered by search text and reporter.'
  })
  async bugReports(
    @Args('filter', { type: () => BugReportsFilterInput, nullable: true }) filter?: BugReportsFilterInput | null
  ): Promise<BugReportsResult> {
    const bugs = await this.bugReportService.findAll(filter ?? undefined);

    const items: BugReportSummary[] = await Promise.all(
      bugs.map(async (b) => {
        const baseAttachments = (b.attachments ?? []).filter(
          (a) => a && typeof a.key === 'string' && a.key.length > 0
        );

        const attachmentsWithUrls: BugAttachment[] = await Promise.all(
          baseAttachments.map(async (a) => {
            const url = await this.bugReportAttachmentsService.createPresignedDownload(a.key, a.contentType);
            return {
              filename: a.filename,
              key: a.key,
              contentType: a.contentType,
              size: a.size,
              uploadedAt: a.uploadedAt,
              url: url ?? undefined
            };
          })
        );

        return {
          id: (b as any)._id?.toString?.() ?? (b as any).id,
          description: b.description,
          reporterName: b.reporterName,
          reporterEmail: b.reporterEmail,
          createdAt: b.createdAt,
          attachments: attachmentsWithUrls
        };
      })
    );

    return { items };
  }

  @Query(() => BugReport, {
    nullable: true,
    description: 'Fetch a single bug report by ID.'
  })
  async bugReportById(@Args('id', { type: () => ID }) id: string): Promise<BugReport | null> {
    return this.bugReportService.findById(id);
  }

  @Mutation(() => BugReport, {
    description: 'Create a new bug report for the currently authenticated user.'
  })
  async createBugReport(
    @Args('input', { type: () => CreateBugReportInput }) input: CreateBugReportInput,
    @CurrentUser() user: User
  ): Promise<BugReport> {
    const reporterName = (user as any)?.name || user.preferred_username || null;
    const reporterEmail = user.email || null;
    this.logger.log(`Creating bug report from ${reporterEmail ?? reporterName ?? 'unknown user'}`);
    return this.bugReportService.create(input, reporterName, reporterEmail);
  }

  @Mutation(() => [BugAttachmentUpload], {
    description: 'Create presigned S3 URLs to upload one or more attachments for a bug report.'
  })
  async createBugAttachmentUploadUrls(
    @Args('bugId', { type: () => ID }) bugId: string,
    @Args('files', { type: () => [BugAttachmentUploadRequest] }) files: BugAttachmentUploadRequest[],
    @CurrentUser() user: User
  ): Promise<BugAttachmentUpload[]> {
    this.logger.log(
      `createBugAttachmentUploadUrls called for bugId=${bugId} with ${files.length} file(s) by user=${user.email ?? user.preferred_username}`
    );
    const bug = await this.bugReportService.findById(bugId);
    if (!bug) {
      throw new Error('Bug report not found');
    }

    const uploads = await Promise.all(
      files.map((file) =>
        this.bugReportAttachmentsService.createPresignedUpload({
          bugId,
          filename: file.filename,
          contentType: file.contentType,
          size: file.size
        })
      )
    );

    return uploads;
  }

  @Mutation(() => BugReport, {
    description: 'Record uploaded attachments for a bug report so they appear in the bug details view.'
  })
  async addBugAttachments(
    @Args('bugId', { type: () => ID }) bugId: string,
    @Args('attachments', { type: () => [BugAttachmentInput] }) attachments: BugAttachmentInput[]
  ): Promise<BugReport> {
    this.logger.log(`addBugAttachments called for bugId=${bugId} with ${attachments.length} attachment(s)`);
    const bug = await this.bugReportService.findById(bugId);
    if (!bug) {
      throw new Error('Bug report not found');
    }

    const mapped: BugAttachment[] = attachments.map((a) => ({
      filename: a.filename,
      key: a.key,
      contentType: a.contentType,
      size: a.size,
      uploadedAt: new Date()
    }));

    const updated = await this.bugReportService.addAttachments(bugId, mapped);
    if (!updated) {
      throw new Error('Unable to update bug report attachments');
    }
    return updated;
  }

  @ResolveField(() => [BugAttachment], {
    name: 'attachments',
    description: 'Attachments for this bug report, with temporary download URLs when available.'
  })
  async attachments(@Parent() bug: BugReport): Promise<BugAttachment[]> {
    this.logger.log(`Resolving attachments for bugId=${(bug as any)._id ?? (bug as any).id}`);
    const base = (bug.attachments ?? []).filter(
      (a) => a && typeof a.key === 'string' && a.key.length > 0
    );
    if (!base.length) {
      return [];
    }

    const withUrls = await Promise.all(
      base.map(async (a) => {
        const url = await this.bugReportAttachmentsService.createPresignedDownload(a.key, a.contentType);
        const result: BugAttachment = {
          filename: a.filename,
          key: a.key,
          contentType: a.contentType,
          size: a.size,
          uploadedAt: a.uploadedAt,
          url: url ?? undefined
        };
        return result;
      })
    );

    return withUrls;
  }
}

