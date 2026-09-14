import { Injectable, Logger } from '@nestjs/common';
import mongoose from 'mongoose';
import { HomologyScreening, HomologyScreeningStatus, Job } from './job.model';
import { JobService } from './job.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowNodeService } from '../workflow/services/node.service';
import { DampLabServices } from '../services/damplab-services.services';
import { SecureDnaService } from '../securedna/securedna.service';
import { Region } from '../securedna/region';
import { MAX_SECUREDNA_SEQUENCE_BATCH } from '../securedna/securedna.constants';
import { getMultiValueParamIds } from '../workflow/utils/form-data.util';
import { SCREENED_FIELDS_BY_SERVICE } from './job-screening.constants';
import { getFormStringFromEntries, looksLikeNucleotideSequence, normalizeFormDataToArray, ScreeningTarget } from './job-screening.util';
import { screeningSliceName } from './job-screening-name.util';

/**
 * Homology screening for a job: find the customer-supplied sequences, send them
 * to SecureDNA, record the verdict on the job.
 *
 * Screening runs on submission and is never awaited by the caller — a slow or
 * unreachable synthclient must not be able to hold up a customer's checkout.
 * That is the whole reason the job carries an IN_PROGRESS state.
 */
@Injectable()
export class JobScreeningService {
  private readonly logger = new Logger(JobScreeningService.name);

  constructor(
    private readonly jobService: JobService,
    private readonly workflowService: WorkflowService,
    private readonly workflowNodeService: WorkflowNodeService,
    private readonly dampLabServices: DampLabServices,
    private readonly secureDnaService: SecureDnaService
  ) {}

  /**
   * Every screenable sequence on a job, in workflow then node then field order.
   *
   * A field whose content does not look like DNA is skipped rather than sent —
   * see `looksLikeNucleotideSequence`.
   */
  async collectScreeningTargets(job: Job): Promise<ScreeningTarget[]> {
    const workflows = await this.workflowService.findByIds((job.workflows ?? []) as mongoose.Types.ObjectId[]);
    const targets: ScreeningTarget[] = [];

    for (const workflow of workflows) {
      const workflowId = String(workflow._id);
      const nodeIds = (workflow.nodes ?? []).map((n: unknown) => String((n as { _id?: unknown })._id ?? n));
      const nodes = await this.workflowNodeService.getByIDs(nodeIds);
      const byId = new Map(nodes.map((n) => [String(n._id), n]));

      for (const nodeId of nodeIds) {
        const node = byId.get(nodeId);
        if (!node?.service) continue;
        const service = await this.dampLabServices.findOne(String(node.service));
        if (!service) continue;

        const fields = SCREENED_FIELDS_BY_SERVICE.get(service.name);
        if (!fields) continue;

        const entries = normalizeFormDataToArray(node.formData, getMultiValueParamIds(service.parameters));
        for (const field of fields) {
          const seq = getFormStringFromEntries(entries, field);
          if (!seq || !looksLikeNucleotideSequence(seq)) continue;
          targets.push({ name: screeningSliceName(workflowId, node.id, field), seq });
        }
      }
    }

    return targets;
  }

  /**
   * Screen a job and record the outcome. Safe to call without awaiting: it
   * resolves rather than rejects, having written a terminal status either way.
   */
  async screenJob(jobId: string, userSub: string): Promise<HomologyScreening> {
    const job = await this.jobService.findById(jobId);
    if (!job) {
      this.logger.warn(`Screening skipped: job ${jobId} not found`);
      return this.record(jobId, {
        status: HomologyScreeningStatus.UNAVAILABLE,
        startedAt: new Date(),
        completedAt: new Date(),
        sequenceCount: 0,
        detail: 'Job not found'
      });
    }

    let targets: ScreeningTarget[];
    try {
      targets = await this.collectScreeningTargets(job);
    } catch (error) {
      return this.unavailable(jobId, 0, `Could not read the job's sequences: ${messageOf(error)}`);
    }

    if (targets.length === 0) {
      return this.record(jobId, {
        status: HomologyScreeningStatus.UNAVAILABLE,
        startedAt: new Date(),
        completedAt: new Date(),
        sequenceCount: 0,
        detail: 'No Gibson Assembly or Modular Cloning sequences on this job'
      });
    }
    if (targets.length > MAX_SECUREDNA_SEQUENCE_BATCH) {
      return this.unavailable(jobId, targets.length, `Too many sequences for one batch (max ${MAX_SECUREDNA_SEQUENCE_BATCH})`);
    }

    const startedAt = new Date();
    await this.record(jobId, { status: HomologyScreeningStatus.IN_PROGRESS, startedAt, sequenceCount: targets.length });

    try {
      const batch = await this.secureDnaService.screenSequences({
        sequences: targets,
        region: Region.ALL,
        providerReference: `damplab-job-${jobId}`,
        jobId,
        userId: userSub
      });

      await this.jobService.appendScreeningBatchId(jobId, new mongoose.Types.ObjectId(batch.id));

      const denied = batch.synthesisPermission !== 'granted';
      const errorCount = batch.errors.length;
      const flaggedSequences = batch.sequences.filter((s) => s.threats.length > 0).length;

      // SecureDNA errors are diagnostics about the request, not hazard hits: a
      // batch that errored did not really screen, so it is unavailable rather
      // than a failure attributable to the customer's sequence.
      if (errorCount > 0 && !denied) {
        return this.unavailable(jobId, targets.length, `SecureDNA reported ${errorCount} error(s)`, batch.id, startedAt);
      }

      return this.record(jobId, {
        status: denied ? HomologyScreeningStatus.FAILED : HomologyScreeningStatus.PASSED,
        startedAt,
        completedAt: new Date(),
        batchId: batch.id,
        sequenceCount: targets.length,
        detail: denied ? `SecureDNA denied synthesis${flaggedSequences ? ` — ${flaggedSequences} of ${targets.length} sequence(s) flagged` : ''}` : null
      });
    } catch (error) {
      this.logger.error(`Homology screening failed for job ${jobId}: ${messageOf(error)}`);
      return this.unavailable(jobId, targets.length, messageOf(error), undefined, startedAt);
    }
  }

  /** Dispatch without blocking the caller. Errors are recorded, never thrown. */
  screenJobInBackground(jobId: string, userSub: string): void {
    void this.screenJob(jobId, userSub).catch((error) => {
      this.logger.error(`Unhandled screening failure for job ${jobId}: ${messageOf(error)}`);
    });
  }

  private unavailable(jobId: string, sequenceCount: number, detail: string, batchId?: string, startedAt?: Date): Promise<HomologyScreening> {
    return this.record(jobId, {
      status: HomologyScreeningStatus.UNAVAILABLE,
      startedAt: startedAt ?? new Date(),
      completedAt: new Date(),
      batchId: batchId ?? null,
      sequenceCount,
      detail
    });
  }

  private async record(jobId: string, screening: HomologyScreening): Promise<HomologyScreening> {
    await this.jobService.setHomologyScreening(jobId, screening);
    return screening;
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  const response = (error as { response?: { message?: string } })?.response?.message;
  return response ?? String(error);
}
