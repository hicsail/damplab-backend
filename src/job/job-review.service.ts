import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model } from 'mongoose';
import { CommentAuthorType } from '../comment/comment.model';
import { CommentService } from '../comment/comment.service';
import { JobVersion, JobVersionAuthorRole } from '../job-version/job-version.model';
import { JobVersionService } from '../job-version/job-version.service';
import { SOWService } from '../sow/sow.service';
import { ActivityService } from '../activity/activity.service';
import { ContractFingerprintWorkflowInput, contractFingerprint } from './contract-fingerprint.util';
import { JobReviewDecision, RespondToJobReviewInput, ReviewJobInput } from './dto/review-job.input';
import { CustomerActionRequired, Job, JobDocument, JobState } from './job.model';
import { JobReviewCommandKind, JobReviewOperation, JobReviewOperationDocument, JobReviewOperationStatus } from './job-review-operation.model';

export interface JobReviewActor {
  sub: string;
  name: string;
}

interface OperationIdentity {
  operationId: string;
  jobId: string;
  commandKind: JobReviewCommandKind;
  actorSub: string;
  decision?: JobReviewDecision;
  responseAction?: CustomerActionRequired;
  normalizedMessage?: string;
}

interface ReviewMapping {
  action: CustomerActionRequired;
  editing: boolean;
  heading: string;
}

@Injectable()
export class JobReviewService {
  constructor(
    @InjectModel(Job.name) private readonly jobModel: Model<JobDocument>,
    @InjectModel(JobReviewOperation.name) private readonly operationModel: Model<JobReviewOperationDocument>,
    private readonly jobVersionService: JobVersionService,
    @Inject(forwardRef(() => CommentService))
    private readonly commentService: CommentService,
    @Inject(forwardRef(() => SOWService))
    private readonly sowService: SOWService,
    private readonly activityService: ActivityService
  ) {}

  private normalizeOperationId(value: string): string {
    const operationId = value?.trim();
    if (!operationId) throw new BadRequestException('operationId cannot be empty');
    return operationId;
  }

  private normalizeMessage(value?: string): string | undefined {
    return value?.trim() || undefined;
  }

  private payloadHash(identity: OperationIdentity): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          commandKind: identity.commandKind,
          jobId: identity.jobId,
          actorSub: identity.actorSub,
          decision: identity.decision ?? null,
          responseAction: identity.responseAction ?? null,
          normalizedMessage: identity.normalizedMessage ?? null
        })
      )
      .digest('hex');
  }

  private assertOperationMatches(operation: JobReviewOperation, identity: OperationIdentity): void {
    const expectedHash = this.payloadHash(identity);
    if (operation.jobId !== identity.jobId || operation.commandKind !== identity.commandKind || operation.actorSub !== identity.actorSub || operation.payloadHash !== expectedHash) {
      throw new ConflictException('operationId is already in use for a different job review command.');
    }
  }

  private reviewMapping(decision: Exclude<JobReviewDecision, JobReviewDecision.ACCEPT>): ReviewMapping {
    switch (decision) {
      case JobReviewDecision.REQUEST_CLARIFICATION:
        return { action: CustomerActionRequired.REPLY, editing: false, heading: 'Clarification requested' };
      case JobReviewDecision.REQUEST_EDITS:
        return { action: CustomerActionRequired.EDIT_WORKFLOW, editing: true, heading: 'Workflow edits requested' };
      case JobReviewDecision.REQUEST_APPROVAL:
        return { action: CustomerActionRequired.APPROVE_WORKFLOW, editing: false, heading: 'Workflow approval requested' };
    }
  }

  private commentContent(header: string, message?: string): string {
    return message ? `${header}\n\n${message}` : header;
  }

  private originalFields(job: Job): Record<string, unknown> {
    return {
      originalState: job.state,
      originalCustomerActionRequired: job.customerActionRequired ?? null,
      originalCustomerEditingEnabled: job.customerEditingEnabled === true,
      originalAcceptedJobVersionNumber: job.acceptedJobVersionNumber ?? null,
      originalAcceptedContractFingerprint: job.acceptedContractFingerprint ?? null,
      originalAcceptedBillingFingerprint: job.acceptedBillingFingerprint ?? null,
      originalAcceptedAt: job.acceptedAt ?? null,
      originalAcceptedBy: job.acceptedBy ?? null,
      originalReviewOperationId: job.lastReviewOperationId ?? null
    };
  }

  private async findOperation(operationId: string): Promise<JobReviewOperation | null> {
    return this.operationModel.findOne({ operationId }).exec();
  }

  private async createOperation(input: Record<string, unknown>, identity: OperationIdentity): Promise<JobReviewOperation> {
    try {
      return await this.operationModel.create({
        ...input,
        operationId: identity.operationId,
        jobId: identity.jobId,
        commandKind: identity.commandKind,
        actorSub: identity.actorSub,
        payloadHash: this.payloadHash(identity),
        status: JobReviewOperationStatus.PENDING
      });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      const raced = await this.findOperation(identity.operationId);
      if (!raced) throw error;
      this.assertOperationMatches(raced, identity);
      return raced;
    }
  }

  private async updateOperationProgress(operation: JobReviewOperation, patch: Partial<JobReviewOperation>): Promise<JobReviewOperation> {
    if (patch.status !== undefined) throw new Error('Operation status transitions require compare-and-set.');
    const updated = await this.operationModel.findOneAndUpdate({ operationId: operation.operationId }, { $set: patch }, { new: true }).exec();
    if (!updated) throw new ConflictException(`Review operation ${operation.operationId} no longer exists.`);
    Object.assign(operation, patch);
    return updated;
  }

  private async casOperationStatus(operation: JobReviewOperation, expected: JobReviewOperationStatus, next: JobReviewOperationStatus, patch: Partial<JobReviewOperation> = {}): Promise<boolean> {
    const updated = await this.operationModel.findOneAndUpdate({ operationId: operation.operationId, status: expected }, { $set: { ...patch, status: next } }, { new: true }).exec();
    if (updated) {
      Object.assign(operation, typeof (updated as any).toObject === 'function' ? (updated as any).toObject() : updated);
      return true;
    }
    const current = await this.findOperation(operation.operationId);
    if (!current) throw new ConflictException(`Review operation ${operation.operationId} no longer exists.`);
    Object.assign(operation, typeof (current as any).toObject === 'function' ? (current as any).toObject() : current);
    return false;
  }

  private async conflictOperation(operation: JobReviewOperation, message: string, expected: JobReviewOperationStatus = operation.status): Promise<never> {
    await this.casOperationStatus(operation, expected, JobReviewOperationStatus.CONFLICTED);
    throw new ConflictException(message);
  }

  private assertOperationResumable(operation: JobReviewOperation): void {
    if (operation.status === JobReviewOperationStatus.CONFLICTED) {
      throw new ConflictException('This review operation previously conflicted and cannot be resumed.');
    }
    if (operation.status === JobReviewOperationStatus.COMPENSATED) {
      throw this.compensatedAcceptanceConflict();
    }
  }

  private async loadOrCreateReviewOperation(input: ReviewJobInput, actor: JobReviewActor): Promise<JobReviewOperation> {
    const operationId = this.normalizeOperationId(input.operationId);
    const normalizedMessage = this.normalizeMessage(input.message);
    if (input.decision !== JobReviewDecision.ACCEPT && !normalizedMessage) {
      throw new BadRequestException('A message is required when requesting customer action.');
    }

    const identity: OperationIdentity = {
      operationId,
      jobId: input.jobId,
      commandKind: JobReviewCommandKind.REVIEW,
      actorSub: actor.sub,
      decision: input.decision,
      normalizedMessage
    };
    const existing = await this.findOperation(operationId);
    if (existing) {
      this.assertOperationMatches(existing, identity);
      return existing;
    }

    const job = await this.jobModel.findById(input.jobId).exec();
    if (!job) throw new NotFoundException(`Job with ID ${input.jobId} not found`);

    let selectedVersion: JobVersion | null = null;
    let selectedContractFingerprint: string | undefined;
    let selectedBillingFingerprint: string | undefined;
    if (input.decision === JobReviewDecision.ACCEPT) {
      // Force the lazy v1 backfill first, exactly as appendStateEvent does. A job
      // submitted before versioning existed has no content version until someone
      // reads its history; getLatestContentVersion is a plain findOne and would
      // not create one, so accepting such a job would fail with "no content
      // version to accept" and staff would have no way to clear it.
      await this.jobVersionService.listByJob(input.jobId);
      selectedVersion = await this.jobVersionService.getLatestContentVersion(input.jobId);
      if (!selectedVersion) throw new BadRequestException('This job has no content version to accept.');
      selectedContractFingerprint = contractFingerprint({
        customerCategory: job.customerCategory,
        workflows: selectedVersion.workflows as unknown as ContractFingerprintWorkflowInput[]
      });
      selectedBillingFingerprint = await this.sowService.jobBillingFingerprint(job);
    }

    const operation = await this.createOperation(
      {
        actorName: actor.name,
        decision: input.decision,
        normalizedMessage,
        ...this.originalFields(job),
        selectedAcceptedVersionNumber: selectedVersion?.versionNumber,
        selectedContractFingerprint,
        selectedBillingFingerprint
      },
      identity
    );
    this.assertOperationMatches(operation, identity);
    return operation;
  }

  private async loadOrCreateResponseOperation(input: RespondToJobReviewInput, actor: JobReviewActor): Promise<JobReviewOperation> {
    const operationId = this.normalizeOperationId(input.operationId);
    const normalizedMessage = this.normalizeMessage(input.message);
    const existing = await this.findOperation(operationId);
    if (existing) {
      const identity: OperationIdentity = {
        operationId,
        jobId: input.jobId,
        commandKind: JobReviewCommandKind.RESPOND,
        actorSub: actor.sub,
        responseAction: existing.responseAction,
        normalizedMessage
      };
      this.assertOperationMatches(existing, identity);
      if (!existing.jobWrittenAt || existing.status === JobReviewOperationStatus.COMPLETE) {
        const currentJob = await this.jobModel.findById(input.jobId).exec();
        if (currentJob?.state === JobState.CHANGES_REQUESTED && currentJob.customerActionRequired != null && currentJob.customerActionRequired !== existing.responseAction) {
          throw new ConflictException('operationId belongs to a response for a different customer action.');
        }
      }
      return existing;
    }

    const job = await this.jobModel.findById(input.jobId).exec();
    if (!job) throw new NotFoundException(`Job with ID ${input.jobId} not found`);
    if (job.sub !== actor.sub) throw new ForbiddenException('You do not have permission to respond to this job review.');
    if (job.state !== JobState.CHANGES_REQUESTED || !job.customerActionRequired) {
      throw new BadRequestException('This job is not awaiting a customer response.');
    }
    if (job.customerActionRequired === CustomerActionRequired.REPLY && !normalizedMessage) {
      throw new BadRequestException('A message is required when replying to a clarification request.');
    }

    const identity: OperationIdentity = {
      operationId,
      jobId: input.jobId,
      commandKind: JobReviewCommandKind.RESPOND,
      actorSub: actor.sub,
      responseAction: job.customerActionRequired,
      normalizedMessage
    };
    const operation = await this.createOperation(
      {
        actorName: actor.name,
        responseAction: job.customerActionRequired,
        normalizedMessage,
        ...this.originalFields(job)
      },
      identity
    );
    this.assertOperationMatches(operation, identity);
    return operation;
  }

  private originalJobFilter(operation: JobReviewOperation): Record<string, unknown> {
    return {
      _id: operation.jobId,
      state: operation.originalState,
      customerActionRequired: operation.originalCustomerActionRequired ?? null,
      customerEditingEnabled: operation.originalCustomerEditingEnabled ? true : { $ne: true },
      acceptedJobVersionNumber: operation.originalAcceptedJobVersionNumber ?? null,
      acceptedContractFingerprint: operation.originalAcceptedContractFingerprint ?? null,
      acceptedBillingFingerprint: operation.originalAcceptedBillingFingerprint ?? null,
      acceptedAt: operation.originalAcceptedAt ?? null,
      acceptedBy: operation.originalAcceptedBy ?? null,
      lastReviewOperationId: operation.originalReviewOperationId ?? null
    };
  }

  private reviewTargetIsApplied(operation: JobReviewOperation, job: Job): boolean {
    if (job.lastReviewOperationId !== operation.operationId) return false;
    if (operation.decision === JobReviewDecision.ACCEPT) {
      return job.state === JobState.ACCEPTED && job.acceptedJobVersionNumber === operation.selectedAcceptedVersionNumber;
    }
    const mapping = this.reviewMapping(operation.decision as Exclude<JobReviewDecision, JobReviewDecision.ACCEPT>);
    return job.state === JobState.CHANGES_REQUESTED && job.customerActionRequired === mapping.action && job.customerEditingEnabled === mapping.editing;
  }

  private responseTargetIsApplied(operation: JobReviewOperation, job: Job): boolean {
    return job.lastReviewOperationId === operation.operationId && job.state === JobState.SUBMITTED && job.customerActionRequired == null && job.customerEditingEnabled !== true;
  }

  private async markJobWritten(operation: JobReviewOperation): Promise<void> {
    const applied = await this.casOperationStatus(operation, JobReviewOperationStatus.PENDING, JobReviewOperationStatus.APPLIED, { jobWrittenAt: new Date() });
    if (!applied && operation.status !== JobReviewOperationStatus.APPLIED) this.assertOperationResumable(operation);
  }

  private async ensureReviewJobWritten(operation: JobReviewOperation): Promise<Job> {
    let job = await this.jobModel.findById(operation.jobId).exec();
    if (!job) throw new NotFoundException(`Job with ID ${operation.jobId} not found`);
    if (operation.jobWrittenAt) return job;
    if (this.reviewTargetIsApplied(operation, job)) {
      await this.markJobWritten(operation);
      return job;
    }

    if (![JobState.SUBMITTED, JobState.CHANGES_REQUESTED, JobState.ACCEPTED].includes(operation.originalState)) {
      await this.casOperationStatus(operation, JobReviewOperationStatus.PENDING, JobReviewOperationStatus.CONFLICTED);
      throw new BadRequestException('Only submitted, changes-requested, or accepted jobs can be reviewed.');
    }
    if (operation.decision === JobReviewDecision.ACCEPT) {
      const latest = await this.jobVersionService.getLatestContentVersion(operation.jobId);
      if (latest?.versionNumber !== operation.selectedAcceptedVersionNumber) {
        return this.conflictOperation(operation, 'The latest job content changed before acceptance could be recorded.');
      }
    }

    let target: Record<string, unknown>;
    if (operation.decision === JobReviewDecision.ACCEPT) {
      target = {
        state: JobState.ACCEPTED,
        customerActionRequired: null,
        customerEditingEnabled: false,
        acceptedJobVersionNumber: operation.selectedAcceptedVersionNumber,
        acceptedContractFingerprint: operation.selectedContractFingerprint,
        acceptedBillingFingerprint: operation.selectedBillingFingerprint,
        acceptedAt: new Date(),
        acceptedBy: operation.actorSub,
        lastReviewOperationId: operation.operationId
      };
    } else {
      const mapping = this.reviewMapping(operation.decision as Exclude<JobReviewDecision, JobReviewDecision.ACCEPT>);
      target = {
        state: JobState.CHANGES_REQUESTED,
        customerActionRequired: mapping.action,
        customerEditingEnabled: mapping.editing,
        lastReviewOperationId: operation.operationId
      };
    }

    job = await this.jobModel.findOneAndUpdate(this.originalJobFilter(operation), { $set: target, $unset: { lastReviewCustomerAction: '' } }, { new: true }).exec();
    if (!job) {
      const raced = await this.jobModel.findById(operation.jobId).exec();
      if (raced && this.reviewTargetIsApplied(operation, raced)) {
        await this.markJobWritten(operation);
        return raced;
      }
      return this.conflictOperation(operation, 'The job changed while it was being reviewed.');
    }
    await this.markJobWritten(operation);
    return job;
  }

  private async ensureResponseJobWritten(operation: JobReviewOperation): Promise<Job> {
    let job = await this.jobModel.findById(operation.jobId).exec();
    if (!job) throw new NotFoundException(`Job with ID ${operation.jobId} not found`);
    if (operation.jobWrittenAt) return job;
    if (this.responseTargetIsApplied(operation, job)) {
      await this.markJobWritten(operation);
      return job;
    }

    job = await this.jobModel
      .findOneAndUpdate(
        this.originalJobFilter(operation),
        {
          $set: {
            state: JobState.SUBMITTED,
            customerActionRequired: null,
            customerEditingEnabled: false,
            lastReviewOperationId: operation.operationId
          },
          $unset: { lastReviewCustomerAction: '' }
        },
        { new: true }
      )
      .exec();
    if (!job) {
      const raced = await this.jobModel.findById(operation.jobId).exec();
      if (raced && this.responseTargetIsApplied(operation, raced)) {
        await this.markJobWritten(operation);
        return raced;
      }
      return this.conflictOperation(operation, 'The job changed while the response was being submitted.');
    }
    await this.markJobWritten(operation);
    return job;
  }

  private async writeReviewHistory(operation: JobReviewOperation, job: Job): Promise<void> {
    if (operation.historyWrittenAt) return;
    if (operation.decision === JobReviewDecision.ACCEPT) {
      const version = await this.jobVersionService.getContentVersion(operation.jobId, operation.selectedAcceptedVersionNumber!);
      if (!version) return this.conflictOperation(operation, 'The selected accepted job version no longer exists.');
      await this.jobVersionService.appendStateEvent(
        job,
        JobState.ACCEPTED,
        { role: JobVersionAuthorRole.STAFF, sub: operation.actorSub, name: operation.actorName },
        'Accepted',
        operation.operationId,
        version.workflows
      );
    } else {
      const mapping = this.reviewMapping(operation.decision as Exclude<JobReviewDecision, JobReviewDecision.ACCEPT>);
      await this.jobVersionService.appendStateEvent(
        job,
        JobState.CHANGES_REQUESTED,
        { role: JobVersionAuthorRole.STAFF, sub: operation.actorSub, name: operation.actorName },
        mapping.heading,
        operation.operationId
      );
    }
    await this.updateOperationProgress(operation, { historyWrittenAt: new Date() });
  }

  private async writeReviewPublication(operation: JobReviewOperation): Promise<void> {
    if (operation.decision !== JobReviewDecision.ACCEPT || operation.publishedAt) return;
    await this.jobVersionService.publishVersion(operation.jobId, operation.selectedAcceptedVersionNumber!, operation.actorSub);
    await this.updateOperationProgress(operation, { publishedAt: new Date() });
  }

  private async writeReviewComment(operation: JobReviewOperation): Promise<void> {
    if (operation.commentWrittenAt) return;
    const heading = operation.decision === JobReviewDecision.ACCEPT ? 'Accepted' : this.reviewMapping(operation.decision as Exclude<JobReviewDecision, JobReviewDecision.ACCEPT>).heading;
    // Offered only where the customer can actually act on it. Pointing someone
    // at an editor they are not allowed to save from is worse than no link, and
    // REQUEST_EDITS is the one decision that opens the canvas to them.
    // CommentBody linkifies exactly this `[label](url)` form.
    const editorLink = operation.decision === JobReviewDecision.REQUEST_EDITS ? `\n\n[Open the workflow editor](/job_editor/${operation.jobId})` : '';
    await this.commentService.createIdempotent({
      jobId: operation.jobId,
      operationId: operation.operationId,
      content: `${this.commentContent(`Review decision: ${heading}`, operation.normalizedMessage)}${editorLink}`,
      author: operation.actorName,
      authorType: CommentAuthorType.STAFF,
      isInternal: false
    });
    await this.updateOperationProgress(operation, { commentWrittenAt: new Date() });
  }

  private async writeReviewActivity(operation: JobReviewOperation): Promise<void> {
    if (operation.activityWrittenAt) return;
    const decision = operation.decision === JobReviewDecision.ACCEPT ? 'Accepted' : this.reviewMapping(operation.decision as Exclude<JobReviewDecision, JobReviewDecision.ACCEPT>).heading;
    await this.activityService.createEventIdempotent({
      type: 'JOB_REVIEWED',
      operationId: `JOB_REVIEWED:${operation.operationId}`,
      message: `Job review decision: ${decision}`,
      actorDisplayName: operation.actorName,
      jobId: operation.jobId
    });
    await this.updateOperationProgress(operation, { activityWrittenAt: new Date() });
  }

  private async writeResponseHistory(operation: JobReviewOperation, job: Job): Promise<void> {
    if (operation.historyWrittenAt) return;
    const header = `Customer response: ${operation.responseAction}`;
    await this.jobVersionService.appendStateEvent(job, JobState.SUBMITTED, { role: JobVersionAuthorRole.CUSTOMER, sub: operation.actorSub, name: operation.actorName }, header, operation.operationId);
    await this.updateOperationProgress(operation, { historyWrittenAt: new Date() });
  }

  private async writeResponseComment(operation: JobReviewOperation): Promise<void> {
    if (operation.commentWrittenAt) return;
    await this.commentService.createIdempotent({
      jobId: operation.jobId,
      operationId: operation.operationId,
      content: this.commentContent(`Customer response: ${operation.responseAction}`, operation.normalizedMessage),
      author: operation.actorName,
      authorType: CommentAuthorType.CLIENT,
      isInternal: false
    });
    await this.updateOperationProgress(operation, { commentWrittenAt: new Date() });
  }

  private async writeResponseActivity(operation: JobReviewOperation): Promise<void> {
    if (operation.activityWrittenAt) return;
    await this.activityService.createEventIdempotent({
      type: 'JOB_REVIEW_RESPONSE',
      operationId: `JOB_REVIEW_RESPONSE:${operation.operationId}`,
      message: `Customer completed requested action: ${operation.responseAction}`,
      actorDisplayName: operation.actorName,
      jobId: operation.jobId
    });
    await this.updateOperationProgress(operation, { activityWrittenAt: new Date() });
  }

  private acceptanceRestoreUpdate(operation: JobReviewOperation): { $set: Record<string, unknown>; $unset?: Record<string, string> } {
    const $set: Record<string, unknown> = {
      state: operation.originalState,
      customerActionRequired: operation.originalCustomerActionRequired ?? null,
      customerEditingEnabled: operation.originalCustomerEditingEnabled,
      acceptedJobVersionNumber: operation.originalAcceptedJobVersionNumber ?? null,
      acceptedContractFingerprint: operation.originalAcceptedContractFingerprint ?? null,
      acceptedBillingFingerprint: operation.originalAcceptedBillingFingerprint ?? null,
      acceptedAt: operation.originalAcceptedAt ?? null,
      acceptedBy: operation.originalAcceptedBy ?? null
    };
    if (operation.originalReviewOperationId) {
      $set.lastReviewOperationId = operation.originalReviewOperationId;
      return { $set, $unset: { lastReviewCustomerAction: '' } };
    }
    return { $set, $unset: { lastReviewOperationId: '', lastReviewCustomerAction: '' } };
  }

  private compensatedAcceptanceConflict(): ConflictException {
    return new ConflictException('The latest job content changed during acceptance; the authoritative Job acceptance was restored.');
  }

  private async finishAcceptanceCompensation(operation: JobReviewOperation): Promise<never> {
    if (operation.status === JobReviewOperationStatus.COMPENSATED) throw this.compensatedAcceptanceConflict();
    if (operation.status !== JobReviewOperationStatus.COMPENSATING) {
      throw new ConflictException('This acceptance operation is not eligible for compensation.');
    }
    await this.jobModel
      .findOneAndUpdate(
        {
          _id: operation.jobId,
          lastReviewOperationId: operation.operationId,
          acceptedJobVersionNumber: operation.selectedAcceptedVersionNumber
        },
        this.acceptanceRestoreUpdate(operation),
        { new: true }
      )
      .exec();
    await this.casOperationStatus(operation, JobReviewOperationStatus.COMPENSATING, JobReviewOperationStatus.COMPENSATED, { compensatedAt: new Date() });
    throw this.compensatedAcceptanceConflict();
  }

  private async completedJob(operation: JobReviewOperation): Promise<Job> {
    const completed = await this.jobModel.findById(operation.jobId).exec();
    if (!completed) throw new NotFoundException(`Job with ID ${operation.jobId} not found`);
    return completed;
  }

  private async finalizeReviewOperation(operation: JobReviewOperation, job: Job): Promise<Job> {
    if (operation.status === JobReviewOperationStatus.COMPLETE) {
      await this.writeReviewActivity(operation);
      return this.completedJob(operation);
    }
    if (operation.status !== JobReviewOperationStatus.FINALIZING) {
      if ([JobReviewOperationStatus.COMPENSATING, JobReviewOperationStatus.COMPENSATED].includes(operation.status)) {
        return this.finishAcceptanceCompensation(operation);
      }
      throw new ConflictException('This review operation is not eligible for finalization.');
    }
    await this.writeReviewHistory(operation, job);
    await this.writeReviewPublication(operation);
    await this.writeReviewComment(operation);
    await this.writeReviewActivity(operation);
    const completed = await this.casOperationStatus(operation, JobReviewOperationStatus.FINALIZING, JobReviewOperationStatus.COMPLETE, { completedAt: new Date() });
    if (!completed && (operation.status as JobReviewOperationStatus) !== JobReviewOperationStatus.COMPLETE) {
      throw new ConflictException('This review operation could not complete finalization.');
    }
    return this.completedJob(operation);
  }

  private async completeAcceptanceOperation(operation: JobReviewOperation, job: Job): Promise<Job> {
    if (operation.status === JobReviewOperationStatus.COMPLETE) return this.completedJob(operation);
    if ([JobReviewOperationStatus.COMPENSATING, JobReviewOperationStatus.COMPENSATED].includes(operation.status)) {
      return this.finishAcceptanceCompensation(operation);
    }
    if (operation.status === JobReviewOperationStatus.APPLIED) {
      const latest = await this.jobVersionService.getLatestContentVersion(operation.jobId);
      const next = latest?.versionNumber === operation.selectedAcceptedVersionNumber ? JobReviewOperationStatus.FINALIZING : JobReviewOperationStatus.COMPENSATING;
      await this.casOperationStatus(operation, JobReviewOperationStatus.APPLIED, next);
    }
    if ([JobReviewOperationStatus.COMPENSATING, JobReviewOperationStatus.COMPENSATED].includes(operation.status)) {
      return this.finishAcceptanceCompensation(operation);
    }
    return this.finalizeReviewOperation(operation, job);
  }

  private async completeReviewOperation(operation: JobReviewOperation): Promise<Job> {
    this.assertOperationResumable(operation);
    if (operation.status === JobReviewOperationStatus.COMPLETE) {
      await this.writeReviewActivity(operation);
      return this.completedJob(operation);
    }
    if ([JobReviewOperationStatus.COMPENSATING, JobReviewOperationStatus.COMPENSATED].includes(operation.status)) {
      return this.finishAcceptanceCompensation(operation);
    }

    const job = operation.status === JobReviewOperationStatus.PENDING ? await this.ensureReviewJobWritten(operation) : await this.completedJob(operation);
    if (operation.decision === JobReviewDecision.ACCEPT) return this.completeAcceptanceOperation(operation, job);
    if (operation.status === JobReviewOperationStatus.APPLIED) {
      await this.casOperationStatus(operation, JobReviewOperationStatus.APPLIED, JobReviewOperationStatus.FINALIZING);
    }
    return this.finalizeReviewOperation(operation, job);
  }

  private async completeResponseOperation(operation: JobReviewOperation): Promise<Job> {
    this.assertOperationResumable(operation);
    if (operation.status === JobReviewOperationStatus.COMPLETE) {
      await this.writeResponseActivity(operation);
      return this.completedJob(operation);
    }
    const job = operation.status === JobReviewOperationStatus.PENDING ? await this.ensureResponseJobWritten(operation) : await this.completedJob(operation);
    if (operation.status === JobReviewOperationStatus.APPLIED) {
      await this.casOperationStatus(operation, JobReviewOperationStatus.APPLIED, JobReviewOperationStatus.FINALIZING);
    }
    if (operation.status !== JobReviewOperationStatus.FINALIZING) {
      throw new ConflictException('This response operation is not eligible for finalization.');
    }
    await this.writeResponseHistory(operation, job);
    await this.writeResponseComment(operation);
    await this.writeResponseActivity(operation);
    const completed = await this.casOperationStatus(operation, JobReviewOperationStatus.FINALIZING, JobReviewOperationStatus.COMPLETE, { completedAt: new Date() });
    if (!completed && (operation.status as JobReviewOperationStatus) !== JobReviewOperationStatus.COMPLETE) {
      throw new ConflictException('This response operation could not complete finalization.');
    }
    return this.completedJob(operation);
  }

  async reviewJob(input: ReviewJobInput, actor: JobReviewActor): Promise<Job> {
    const operation = await this.loadOrCreateReviewOperation(input, actor);
    return this.completeReviewOperation(operation);
  }

  async respondToJobReview(input: RespondToJobReviewInput, actor: JobReviewActor): Promise<Job> {
    const operation = await this.loadOrCreateResponseOperation(input, actor);
    return this.completeResponseOperation(operation);
  }
}
