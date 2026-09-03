import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model } from 'mongoose';
import { CommentAuthorType } from '../comment/comment.model';
import { CommentService } from '../comment/comment.service';
import { JobVersion, JobVersionAuthorRole } from '../job-version/job-version.model';
import { JobVersionService } from '../job-version/job-version.service';
import { SOWStatus } from '../sow/sow.model';
import { SOWService } from '../sow/sow.service';
import { ActivityService } from '../activity/activity.service';
import { CancelJobInput, JobReviewDecision, RejectJobReviewInput, RequestJobEditAccessInput, RespondToJobReviewInput, ReviewJobInput, WithdrawJobInput } from './dto/review-job.input';
import { customerMayEdit } from './job-editing';
import { CustomerActionRequired, Job, JobDocument, JobState } from './job.model';
import { JobReviewCommandKind, JobReviewOperation, JobReviewOperationDocument, JobReviewOperationStatus } from './job-review-operation.model';
import { jobVersionAuthorOrg } from '../job-version/author-org';

export interface JobReviewActor {
  sub: string;
  name: string;
  /**
   * The actor's realm roles, straight off their token.
   *
   * Passed rather than a finished org string because the author role a command
   * writes with is fixed by the command, not by the caller — a staff command
   * always stamps STAFF and a customer command always stamps CUSTOMER — so this
   * service is the only place that can turn claims into the right stamp. It is
   * resolved once, when the operation record is created, and persisted on it: a
   * resumed operation must stamp what the original attempt would have, even if
   * the actor's tier has changed since.
   */
  claims?: readonly string[];
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
        return { action: CustomerActionRequired.REPLY, heading: 'Clarification requested' };
      case JobReviewDecision.REQUEST_EDITS:
        return { action: CustomerActionRequired.EDIT_WORKFLOW, heading: 'Workflow edits requested' };
      case JobReviewDecision.REQUEST_APPROVAL:
        return { action: CustomerActionRequired.APPROVE_WORKFLOW, heading: 'Workflow approval requested' };
    }
  }

  private commentContent(header: string, message?: string): string {
    return message ? `${header}\n\n${message}` : header;
  }

  private originalFields(job: Job): Record<string, unknown> {
    return {
      originalState: job.state,
      originalCustomerActionRequired: job.customerActionRequired ?? null,
      originalHandoverVersionNumber: job.handoverVersionNumber ?? null,
      originalAcceptedJobVersionNumber: job.acceptedJobVersionNumber ?? null,
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
    let selectedBillingFingerprint: string | undefined;
    // Handing the job over records what the customer is starting from, so
    // withdrawing it later restores exactly that and not a guess.
    let selectedHandoverVersionNumber: number | undefined;
    if (input.decision !== JobReviewDecision.ACCEPT) {
      await this.jobVersionService.listByJob(input.jobId);
      selectedHandoverVersionNumber = (await this.jobVersionService.getLatestContentVersion(input.jobId))?.versionNumber;
    }
    if (input.decision === JobReviewDecision.ACCEPT) {
      // Force the lazy v1 backfill first, exactly as appendStateEvent does. A job
      // submitted before versioning existed has no content version until someone
      // reads its history; getLatestContentVersion is a plain findOne and would
      // not create one, so accepting such a job would fail with "no content
      // version to accept" and staff would have no way to clear it.
      await this.jobVersionService.listByJob(input.jobId);
      selectedVersion = await this.jobVersionService.getLatestContentVersion(input.jobId);
      if (!selectedVersion) throw new BadRequestException('This job has no content version to accept.');
      selectedBillingFingerprint = await this.sowService.jobBillingFingerprint(job);
    }

    const operation = await this.createOperation(
      {
        actorName: actor.name,
        actorOrg: jobVersionAuthorOrg({ authorRole: JobVersionAuthorRole.STAFF, claims: actor.claims, institute: job.institute }),
        decision: input.decision,
        normalizedMessage,
        ...this.originalFields(job),
        selectedAcceptedVersionNumber: selectedVersion?.versionNumber,
        selectedHandoverVersionNumber,
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
        actorOrg: jobVersionAuthorOrg({ authorRole: JobVersionAuthorRole.CUSTOMER, claims: actor.claims, institute: job.institute }),
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
      handoverVersionNumber: operation.originalHandoverVersionNumber ?? null,
      acceptedJobVersionNumber: operation.originalAcceptedJobVersionNumber ?? null,
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
    return job.state === JobState.CHANGES_REQUESTED && job.customerActionRequired === mapping.action;
  }

  private responseTargetIsApplied(operation: JobReviewOperation, job: Job): boolean {
    return job.lastReviewOperationId === operation.operationId && job.state === JobState.SUBMITTED && job.customerActionRequired == null;
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
        acceptedJobVersionNumber: operation.selectedAcceptedVersionNumber,
        acceptedBillingFingerprint: operation.selectedBillingFingerprint,
        acceptedAt: new Date(),
        acceptedBy: operation.actorSub,
        lastReviewOperationId: operation.operationId,
        // Any decision answers an outstanding "may I edit?" — leaving the flag
        // set would keep telling the client a request is still pending.
        editAccessRequestedAt: null
      };
    } else {
      const mapping = this.reviewMapping(operation.decision as Exclude<JobReviewDecision, JobReviewDecision.ACCEPT>);
      target = {
        state: JobState.CHANGES_REQUESTED,
        customerActionRequired: mapping.action,
        // The baseline a withdrawal restores. Recorded here rather than inferred
        // later: scanning back for the last staff-authored version gets it wrong
        // whenever staff edited before handing over, or across several rounds.
        // A repeat request-changes re-stamps it — each handover is a fresh start.
        handoverVersionNumber: operation.selectedHandoverVersionNumber ?? null,
        lastReviewOperationId: operation.operationId,
        editAccessRequestedAt: null
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
        { role: JobVersionAuthorRole.STAFF, sub: operation.actorSub, name: operation.actorName, org: operation.actorOrg },
        'Accepted',
        operation.operationId,
        version.workflows
      );
    } else {
      const mapping = this.reviewMapping(operation.decision as Exclude<JobReviewDecision, JobReviewDecision.ACCEPT>);
      await this.jobVersionService.appendStateEvent(
        job,
        JobState.CHANGES_REQUESTED,
        { role: JobVersionAuthorRole.STAFF, sub: operation.actorSub, name: operation.actorName, org: operation.actorOrg },
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
    await this.jobVersionService.appendStateEvent(
      job,
      JobState.SUBMITTED,
      { role: JobVersionAuthorRole.CUSTOMER, sub: operation.actorSub, name: operation.actorName, org: operation.actorOrg },
      header,
      operation.operationId
    );
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
      acceptedJobVersionNumber: operation.originalAcceptedJobVersionNumber ?? null,
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

  // ---------------------------------------------------------------------------
  // Withdrawal
  //
  // The two ways staff take a job back so they can edit it again. Both are
  // journaled like a review decision, but neither needs a compensation branch:
  // unlike acceptance they select nothing that can move underneath them, so they
  // resume straight through PENDING → APPLIED → FINALIZING → COMPLETE.
  // ---------------------------------------------------------------------------

  private withdrawalKind(fromCustomer: boolean): JobReviewCommandKind {
    return fromCustomer ? JobReviewCommandKind.WITHDRAW_FROM_CUSTOMER : JobReviewCommandKind.WITHDRAW_ACCEPTANCE;
  }

  private async loadOrCreateWithdrawalOperation(input: WithdrawJobInput, actor: JobReviewActor, fromCustomer: boolean): Promise<JobReviewOperation> {
    const operationId = this.normalizeOperationId(input.operationId);
    const normalizedMessage = this.normalizeMessage(input.reason);
    if (!normalizedMessage) throw new BadRequestException('Give a reason for withdrawing this job.');

    const identity: OperationIdentity = {
      operationId,
      jobId: input.jobId,
      commandKind: this.withdrawalKind(fromCustomer),
      actorSub: actor.sub,
      normalizedMessage
    };
    const existing = await this.findOperation(operationId);
    if (existing) {
      this.assertOperationMatches(existing, identity);
      return existing;
    }

    const job = await this.jobModel.findById(input.jobId).exec();
    if (!job) throw new NotFoundException(`Job with ID ${input.jobId} not found`);

    const requiredState = fromCustomer ? JobState.CHANGES_REQUESTED : JobState.ACCEPTED;
    if (job.state !== requiredState) {
      throw new BadRequestException(fromCustomer ? 'This job is not currently with the customer.' : 'This job has not been accepted.');
    }

    // Captured now so a retry restores the same version even if a later handover
    // moves the baseline.
    const restoreVersionNumber = fromCustomer ? job.handoverVersionNumber ?? undefined : undefined;

    const operation = await this.createOperation(
      {
        actorName: actor.name,
        actorOrg: jobVersionAuthorOrg({ authorRole: JobVersionAuthorRole.STAFF, claims: actor.claims, institute: job.institute }),
        normalizedMessage,
        restoreVersionNumber,
        ...this.originalFields(job)
      },
      identity
    );
    this.assertOperationMatches(operation, identity);
    return operation;
  }

  private withdrawalTargetIsApplied(operation: JobReviewOperation, job: Job): boolean {
    return job.lastReviewOperationId === operation.operationId && job.state === JobState.SUBMITTED && job.customerActionRequired == null;
  }

  private async ensureWithdrawalJobWritten(operation: JobReviewOperation, fromCustomer: boolean): Promise<Job> {
    let job = await this.jobModel.findById(operation.jobId).exec();
    if (!job) throw new NotFoundException(`Job with ID ${operation.jobId} not found`);
    if (operation.jobWrittenAt) return job;
    if (this.withdrawalTargetIsApplied(operation, job)) {
      await this.markJobWritten(operation);
      return job;
    }

    // Withdrawing acceptance clears the whole acceptance stamp. Taking the job
    // back from the customer clears the handover baseline once it is spent.
    const target: Record<string, unknown> = {
      state: JobState.SUBMITTED,
      customerActionRequired: null,
      handoverVersionNumber: null,
      lastReviewOperationId: operation.operationId
    };
    if (!fromCustomer) {
      Object.assign(target, {
        acceptedJobVersionNumber: null,
        acceptedBillingFingerprint: null,
        acceptedAt: null,
        acceptedBy: null
      });
    }

    job = await this.jobModel.findOneAndUpdate(this.originalJobFilter(operation), { $set: target }, { new: true }).exec();
    if (!job) {
      const raced = await this.jobModel.findById(operation.jobId).exec();
      if (raced && this.withdrawalTargetIsApplied(operation, raced)) {
        await this.markJobWritten(operation);
        return raced;
      }
      return this.conflictOperation(operation, 'The job changed while it was being withdrawn.');
    }
    await this.markJobWritten(operation);
    return job;
  }

  /**
   * Puts the graph back to what the customer was handed.
   *
   * Their own saved versions stay in history — they are immutable and already
   * visible — so nothing they did is lost, and Revert can reach it. The restored
   * version is published to them deliberately: undoing someone's work and then
   * hiding the result would leave them believing their edits still stand.
   *
   * The SOW billing core is a cache of the live graph. Restore without syncing
   * it leaves Recalculate showing the customer's unsubmitted draft. Sync runs
   * even on retry: a crash after restore but before the first sync must still
   * catch the cache up. Versions stay frozen; this only rewrites sow.services
   * and flags the document stale.
   */
  private async writeRestore(operation: JobReviewOperation, author: { role: JobVersionAuthorRole }, note: string): Promise<void> {
    if (operation.restoreVersionNumber == null) return;
    if (!operation.restoreWrittenAt) {
      await this.jobVersionService.restoreVersion(
        operation.jobId,
        operation.restoreVersionNumber,
        { role: author.role, sub: operation.actorSub, name: operation.actorName, org: operation.actorOrg },
        note,
        {
          visibleToCustomer: true
        }
      );
      await this.updateOperationProgress(operation, { restoreWrittenAt: new Date() });
    }
    await this.sowService.syncServicesFromJobWorkflows(operation.jobId);
  }

  private async writeWithdrawalRestore(operation: JobReviewOperation): Promise<void> {
    await this.writeRestore(operation, { role: JobVersionAuthorRole.STAFF }, 'Withdrawn by the lab');
  }

  private async writeWithdrawalHistory(operation: JobReviewOperation, job: Job, fromCustomer: boolean): Promise<void> {
    if (operation.historyWrittenAt) return;
    const heading = fromCustomer ? 'Withdrawn from the customer' : 'Acceptance withdrawn';
    await this.jobVersionService.appendStateEvent(
      job,
      JobState.SUBMITTED,
      { role: JobVersionAuthorRole.STAFF, sub: operation.actorSub, name: operation.actorName, org: operation.actorOrg },
      heading,
      operation.operationId
    );
    await this.updateOperationProgress(operation, { historyWrittenAt: new Date() });
  }

  private async writeWithdrawalComment(operation: JobReviewOperation, fromCustomer: boolean): Promise<void> {
    if (operation.commentWrittenAt) return;
    const heading = fromCustomer ? 'The lab has taken this job back for further work' : 'The lab has reopened this job for changes';
    await this.commentService.createIdempotent({
      jobId: operation.jobId,
      operationId: operation.operationId,
      content: this.commentContent(heading, operation.normalizedMessage),
      author: operation.actorName,
      authorType: CommentAuthorType.STAFF,
      isInternal: false
    });
    await this.updateOperationProgress(operation, { commentWrittenAt: new Date() });
  }

  private async writeWithdrawalActivity(operation: JobReviewOperation, fromCustomer: boolean): Promise<void> {
    if (operation.activityWrittenAt) return;
    const type = fromCustomer ? 'JOB_WITHDRAWN_FROM_CUSTOMER' : 'JOB_ACCEPTANCE_WITHDRAWN';
    await this.activityService.createEventIdempotent({
      type,
      operationId: `${type}:${operation.operationId}`,
      message: fromCustomer ? 'Job withdrawn from the customer' : 'Job acceptance withdrawn',
      actorDisplayName: operation.actorName,
      jobId: operation.jobId
    });
    await this.updateOperationProgress(operation, { activityWrittenAt: new Date() });
  }

  private async completeWithdrawalOperation(operation: JobReviewOperation, fromCustomer: boolean): Promise<Job> {
    this.assertOperationResumable(operation);
    if (operation.status === JobReviewOperationStatus.COMPLETE) {
      await this.writeWithdrawalActivity(operation, fromCustomer);
      return this.completedJob(operation);
    }

    const job = operation.status === JobReviewOperationStatus.PENDING ? await this.ensureWithdrawalJobWritten(operation, fromCustomer) : await this.completedJob(operation);
    if (operation.status === JobReviewOperationStatus.APPLIED) {
      await this.casOperationStatus(operation, JobReviewOperationStatus.APPLIED, JobReviewOperationStatus.FINALIZING);
    }
    if (operation.status !== JobReviewOperationStatus.FINALIZING) {
      throw new ConflictException('This withdrawal is not eligible for finalization.');
    }

    // Restore first: the history entry and the comment both describe a graph
    // that has already moved, so a failure here must not leave them claiming a
    // revert that never happened.
    await this.writeWithdrawalRestore(operation);
    await this.writeWithdrawalHistory(operation, job, fromCustomer);
    await this.writeWithdrawalComment(operation, fromCustomer);
    await this.writeWithdrawalActivity(operation, fromCustomer);

    const completed = await this.casOperationStatus(operation, JobReviewOperationStatus.FINALIZING, JobReviewOperationStatus.COMPLETE, { completedAt: new Date() });
    if (!completed && (operation.status as JobReviewOperationStatus) !== JobReviewOperationStatus.COMPLETE) {
      throw new ConflictException('This withdrawal could not complete finalization.');
    }
    return this.completedJob(operation);
  }

  /** Staff take the job back from the customer, restoring the graph they were handed. */
  async withdrawJobFromCustomer(input: WithdrawJobInput, actor: JobReviewActor): Promise<Job> {
    const operation = await this.loadOrCreateWithdrawalOperation(input, actor, true);
    return this.completeWithdrawalOperation(operation, true);
  }

  /** Staff reopen an accepted spec so it can be edited again. */
  async withdrawJobAcceptance(input: WithdrawJobInput, actor: JobReviewActor): Promise<Job> {
    const operation = await this.loadOrCreateWithdrawalOperation(input, actor, false);
    return this.completeWithdrawalOperation(operation, false);
  }

  async reviewJob(input: ReviewJobInput, actor: JobReviewActor): Promise<Job> {
    const operation = await this.loadOrCreateReviewOperation(input, actor);
    return this.completeReviewOperation(operation);
  }

  async respondToJobReview(input: RespondToJobReviewInput, actor: JobReviewActor): Promise<Job> {
    const operation = await this.loadOrCreateResponseOperation(input, actor);
    return this.completeResponseOperation(operation);
  }

  // ---------------------------------------------------------------------------
  // Customer-initiated commands
  //
  // Reject, cancel and request-edit-access are the three things a customer can
  // do to a job besides answering a prompt. All three are journaled exactly like
  // a review decision so a retried submit resumes rather than duplicating, and
  // none needs a compensation branch: unlike acceptance they select nothing that
  // can move underneath them.
  //
  // Ownership is the gate, not a role. These mirror `signSow` and
  // `respondToJobReview`, which check `job.sub` rather than carrying a
  // @RequirePermission — a customer acting on their own job holds no permission
  // beyond the baseline.
  // ---------------------------------------------------------------------------

  private async loadOrCreateCustomerOperation(
    input: { operationId: string; jobId: string },
    actor: JobReviewActor,
    commandKind: JobReviewCommandKind,
    normalizedMessage: string | undefined,
    precondition: (job: Job) => Promise<void> | void,
    // Anything the command selects up front. Captured here, with the journal, so
    // a retry acts on the same selection even if history moved in between.
    select: (job: Job) => Promise<Record<string, unknown>> = async (): Promise<Record<string, unknown>> => ({})
  ): Promise<JobReviewOperation> {
    const operationId = this.normalizeOperationId(input.operationId);
    const identity: OperationIdentity = { operationId, jobId: input.jobId, commandKind, actorSub: actor.sub, normalizedMessage };

    const existing = await this.findOperation(operationId);
    if (existing) {
      this.assertOperationMatches(existing, identity);
      return existing;
    }

    const job = await this.jobModel.findById(input.jobId).exec();
    if (!job) throw new NotFoundException(`Job with ID ${input.jobId} not found`);
    if (job.sub !== actor.sub) throw new ForbiddenException('You do not have permission to act on this job.');
    await precondition(job);

    const operation = await this.createOperation(
      {
        actorName: actor.name,
        actorOrg: jobVersionAuthorOrg({ authorRole: JobVersionAuthorRole.CUSTOMER, claims: actor.claims, institute: job.institute }),
        normalizedMessage,
        ...this.originalFields(job),
        ...(await select(job))
      },
      identity
    );
    this.assertOperationMatches(operation, identity);
    return operation;
  }

  private requireCustomerReason(value: string | undefined, action: string): string {
    const normalized = this.normalizeMessage(value);
    if (!normalized) throw new BadRequestException(`Give a reason for ${action} this job.`);
    return normalized;
  }

  /** The SOW in force for a job, or null. Used by the cancel and edit-access cutoffs. */
  private async sowStatusForJob(jobId: string): Promise<SOWStatus | null> {
    const sow = await this.sowService.findByJobId(jobId);
    return (sow?.status as SOWStatus) ?? null;
  }

  private async writeCustomerComment(operation: JobReviewOperation, heading: string): Promise<void> {
    if (operation.commentWrittenAt) return;
    await this.commentService.createIdempotent({
      jobId: operation.jobId,
      operationId: operation.operationId,
      content: this.commentContent(heading, operation.normalizedMessage),
      author: operation.actorName,
      authorType: CommentAuthorType.CLIENT,
      isInternal: false
    });
    await this.updateOperationProgress(operation, { commentWrittenAt: new Date() });
  }

  private async writeCustomerActivity(operation: JobReviewOperation, type: string, message: string): Promise<void> {
    if (operation.activityWrittenAt) return;
    await this.activityService.createEventIdempotent({
      type,
      operationId: `${type}:${operation.operationId}`,
      message,
      actorDisplayName: operation.actorName,
      jobId: operation.jobId
    });
    await this.updateOperationProgress(operation, { activityWrittenAt: new Date() });
  }

  private async writeCustomerHistory(operation: JobReviewOperation, job: Job, state: JobState, heading: string): Promise<void> {
    if (operation.historyWrittenAt) return;
    await this.jobVersionService.appendStateEvent(
      job,
      state,
      { role: JobVersionAuthorRole.CUSTOMER, sub: operation.actorSub, name: operation.actorName, org: operation.actorOrg },
      heading,
      operation.operationId
    );
    await this.updateOperationProgress(operation, { historyWrittenAt: new Date() });
  }

  // --- Reject -----------------------------------------------------------------

  /**
   * The customer declines what the lab asked them to approve.
   *
   * Lands the job back at SUBMITTED — exactly where a completed response lands
   * it — because a rejection is still the customer handing the job back, not
   * abandoning it. Cancelling is the terminal act, and it is a separate command.
   */
  async rejectJobReview(input: RejectJobReviewInput, actor: JobReviewActor): Promise<Job> {
    const reason = this.requireCustomerReason(input.reason, 'rejecting');
    const operation = await this.loadOrCreateCustomerOperation(
      input,
      actor,
      JobReviewCommandKind.REJECT,
      reason,
      (job) => {
        if (job.state !== JobState.CHANGES_REQUESTED || job.customerActionRequired !== CustomerActionRequired.APPROVE_WORKFLOW) {
          throw new BadRequestException('This job is not awaiting your approval.');
        }
      },
      async (job) => {
        // Rejecting is refusing the lab's changes, so the graph has to go back
        // to what it was before them. Without this the job returned to the lab
        // still carrying the very edits the customer had just refused, and the
        // rejection changed nothing but the state.
        //
        // Force the lazy v1 backfill first, exactly as the review path does: a
        // job submitted before versioning existed has no rows until its history
        // is read, and getCustomerBaselineVersion is a plain findOne.
        await this.jobVersionService.listByJob(String(job._id));
        const baseline = await this.jobVersionService.getCustomerBaselineVersion(String(job._id));
        const latest = await this.jobVersionService.getLatestContentVersion(String(job._id));
        // Nothing to undo when the lab asked for approval without editing
        // anything. Restoring anyway would append a version identical to the one
        // below it, which reads as an edit the customer never made.
        if (!baseline || baseline.versionNumber === latest?.versionNumber) return {};
        return { restoreVersionNumber: baseline.versionNumber };
      }
    );

    this.assertOperationResumable(operation);
    if (operation.status === JobReviewOperationStatus.COMPLETE) {
      await this.writeCustomerActivity(operation, 'JOB_REJECTED', 'Customer rejected the proposed workflow');
      return this.completedJob(operation);
    }

    // The job write is identical to a response: back to the lab, no action
    // outstanding. Sharing it keeps one definition of "returned to the lab".
    const job = operation.status === JobReviewOperationStatus.PENDING ? await this.ensureResponseJobWritten(operation) : await this.completedJob(operation);
    if (operation.status === JobReviewOperationStatus.APPLIED) {
      await this.casOperationStatus(operation, JobReviewOperationStatus.APPLIED, JobReviewOperationStatus.FINALIZING);
    }
    if (operation.status !== JobReviewOperationStatus.FINALIZING) {
      throw new ConflictException('This rejection is not eligible for finalization.');
    }

    // Restore before announcing it: the history entry and the comment both
    // describe a graph that has already moved back, and a failure here must not
    // leave them claiming a revert that never happened.
    await this.writeRestore(operation, { role: JobVersionAuthorRole.CUSTOMER }, 'Rejected the lab’s changes');
    await this.writeCustomerHistory(operation, job, JobState.SUBMITTED, 'Rejected by the customer');
    await this.writeCustomerComment(operation, 'Customer rejected the proposed workflow');
    await this.writeCustomerActivity(operation, 'JOB_REJECTED', 'Customer rejected the proposed workflow');

    const completed = await this.casOperationStatus(operation, JobReviewOperationStatus.FINALIZING, JobReviewOperationStatus.COMPLETE, { completedAt: new Date() });
    if (!completed && (operation.status as JobReviewOperationStatus) !== JobReviewOperationStatus.COMPLETE) {
      throw new ConflictException('This rejection could not complete finalization.');
    }
    return this.completedJob(operation);
  }

  // --- Cancel -----------------------------------------------------------------

  private cancelTargetIsApplied(operation: JobReviewOperation, job: Job): boolean {
    return job.lastReviewOperationId === operation.operationId && job.state === JobState.CANCELLED;
  }

  private async ensureCancelJobWritten(operation: JobReviewOperation): Promise<Job> {
    let job = await this.jobModel.findById(operation.jobId).exec();
    if (!job) throw new NotFoundException(`Job with ID ${operation.jobId} not found`);
    if (operation.jobWrittenAt) return job;
    if (this.cancelTargetIsApplied(operation, job)) {
      await this.markJobWritten(operation);
      return job;
    }

    job = await this.jobModel
      .findOneAndUpdate(
        this.originalJobFilter(operation),
        { $set: { state: JobState.CANCELLED, customerActionRequired: null, editAccessRequestedAt: null, lastReviewOperationId: operation.operationId } },
        { new: true }
      )
      .exec();
    if (!job) {
      const raced = await this.jobModel.findById(operation.jobId).exec();
      if (raced && this.cancelTargetIsApplied(operation, raced)) {
        await this.markJobWritten(operation);
        return raced;
      }
      return this.conflictOperation(operation, 'The job changed while it was being cancelled.');
    }
    await this.markJobWritten(operation);
    return job;
  }

  /**
   * The customer abandons the job.
   *
   * Allowed right up until the SOW is countersigned: a document the customer has
   * signed but the lab has not is still not an agreement, so FINAL — and only
   * FINAL — is the cutoff. Any SOW still standing is cancelled with the job,
   * because leaving a live document attached to a dead job is what would let it
   * be signed afterwards.
   */
  async cancelJob(input: CancelJobInput, actor: JobReviewActor): Promise<Job> {
    const reason = this.requireCustomerReason(input.reason, 'cancelling');
    const operation = await this.loadOrCreateCustomerOperation(input, actor, JobReviewCommandKind.CANCEL, reason, async (job) => {
      if (job.state === JobState.CANCELLED) throw new BadRequestException('This job is already cancelled.');
      if (job.state === JobState.CLOSED) throw new BadRequestException('This job is closed and can no longer be cancelled.');
      const status = await this.sowStatusForJob(String(job._id));
      if (status === SOWStatus.FINAL) {
        throw new BadRequestException('The Statement of Work for this job has been signed by both parties and the job can no longer be cancelled. Contact the lab.');
      }
    });

    this.assertOperationResumable(operation);
    if (operation.status === JobReviewOperationStatus.COMPLETE) {
      await this.writeCustomerActivity(operation, 'JOB_CANCELLED', 'Customer cancelled the job');
      return this.completedJob(operation);
    }

    const job = operation.status === JobReviewOperationStatus.PENDING ? await this.ensureCancelJobWritten(operation) : await this.completedJob(operation);
    if (operation.status === JobReviewOperationStatus.APPLIED) {
      await this.casOperationStatus(operation, JobReviewOperationStatus.APPLIED, JobReviewOperationStatus.FINALIZING);
    }
    if (operation.status !== JobReviewOperationStatus.FINALIZING) {
      throw new ConflictException('This cancellation is not eligible for finalization.');
    }

    // Cancel the document before announcing anything: the comment says the SOW is
    // no longer in effect, and it must not say so before that is true.
    await this.sowService.cancelForCancelledJob(operation.jobId, operation.normalizedMessage, { sub: operation.actorSub, name: operation.actorName });
    await this.writeCustomerHistory(operation, job, JobState.CANCELLED, 'Cancelled by the customer');
    await this.writeCustomerComment(operation, 'Customer cancelled this job');
    await this.writeCustomerActivity(operation, 'JOB_CANCELLED', 'Customer cancelled the job');

    const completed = await this.casOperationStatus(operation, JobReviewOperationStatus.FINALIZING, JobReviewOperationStatus.COMPLETE, { completedAt: new Date() });
    if (!completed && (operation.status as JobReviewOperationStatus) !== JobReviewOperationStatus.COMPLETE) {
      throw new ConflictException('This cancellation could not complete finalization.');
    }
    return this.completedJob(operation);
  }

  // --- Request edit access ----------------------------------------------------

  /**
   * The customer asks for the workflow editor.
   *
   * Deliberately grants nothing. Staff open the canvas the way they already do,
   * with reviewJob(REQUEST_EDITS), so there is still exactly one path that puts a
   * job in the customer's hands and `assertJobContractWritable` stays the only
   * gate. All this records is that an ask is outstanding.
   *
   * Cut off once the customer has signed — a signed document is priced against a
   * spec, and reopening that spec is a withdrawal, which is the lab's call.
   */
  async requestJobEditAccess(input: RequestJobEditAccessInput, actor: JobReviewActor): Promise<Job> {
    const message = this.normalizeMessage(input.message);
    const operation = await this.loadOrCreateCustomerOperation(input, actor, JobReviewCommandKind.REQUEST_EDIT_ACCESS, message, async (job) => {
      if (job.state === JobState.CANCELLED || job.state === JobState.CLOSED) {
        throw new BadRequestException('This job is no longer open.');
      }
      if (customerMayEdit(job)) throw new BadRequestException('You already have edit access to this job.');
      const status = await this.sowStatusForJob(String(job._id));
      if (status === SOWStatus.SIGNED || status === SOWStatus.FINAL) {
        throw new BadRequestException('The Statement of Work for this job has been signed and its workflow can no longer be changed. Contact the lab.');
      }
    });

    this.assertOperationResumable(operation);
    if (operation.status === JobReviewOperationStatus.COMPLETE) {
      await this.writeCustomerActivity(operation, 'JOB_EDIT_ACCESS_REQUESTED', 'Customer requested edit access');
      return this.completedJob(operation);
    }

    if (operation.status === JobReviewOperationStatus.PENDING) {
      // The only write is the pending-request stamp. State is untouched on
      // purpose — this is an ask, and staff answer it with a review decision.
      await this.jobModel.findOneAndUpdate({ _id: operation.jobId }, { $set: { editAccessRequestedAt: new Date() } }).exec();
      await this.markJobWritten(operation);
    }
    if (operation.status === JobReviewOperationStatus.APPLIED) {
      await this.casOperationStatus(operation, JobReviewOperationStatus.APPLIED, JobReviewOperationStatus.FINALIZING);
    }
    if (operation.status !== JobReviewOperationStatus.FINALIZING) {
      throw new ConflictException('This request is not eligible for finalization.');
    }

    await this.writeCustomerComment(operation, 'Customer requested access to edit this job');
    await this.writeCustomerActivity(operation, 'JOB_EDIT_ACCESS_REQUESTED', 'Customer requested edit access');

    const completed = await this.casOperationStatus(operation, JobReviewOperationStatus.FINALIZING, JobReviewOperationStatus.COMPLETE, { completedAt: new Date() });
    if (!completed && (operation.status as JobReviewOperationStatus) !== JobReviewOperationStatus.COMPLETE) {
      throw new ConflictException('This request could not complete finalization.');
    }
    return this.completedJob(operation);
  }
}
