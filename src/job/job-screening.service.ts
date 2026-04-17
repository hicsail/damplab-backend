import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Document, Model } from 'mongoose';
import { Job, JobScreeningBatchDisplay, JobScreeningSliceResult, JobScreeningStatus } from './job.model';
import { JobService } from './job.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowNodeService } from '../workflow/services/node.service';
import { DampLabServices } from '../services/damplab-services.services';
import { MPIService } from '../mpi/mpi.service';
import { Region } from '../mpi/types';
import { MAX_MPI_SEQUENCE_BATCH } from '../mpi/mpi.constants';
import type { ScreeningBatch, Sequence } from '../mpi/models/mpi.model';
import { getMultiValueParamIds } from '../workflow/utils/form-data.util';
import { GIBSON_ASSEMBLY_SERVICE_NAME, M_CLONING_SERVICE_NAME } from './job-screening.constants';
import { getFormStringFromEntries, normalizeFormDataToArray, normalizeSequenceString, ScreeningTarget } from './job-screening.util';
import { parseScreeningSliceName } from './job-screening-name.util';

@Injectable()
export class JobScreeningService {
  constructor(
    private readonly jobService: JobService,
    private readonly workflowService: WorkflowService,
    private readonly workflowNodeService: WorkflowNodeService,
    private readonly dampLabServices: DampLabServices,
    private readonly mpiService: MPIService,
    @InjectModel('ScreeningBatch') private readonly screeningBatchModel: Model<Document>
  ) {}

  async collectScreeningTargets(job: Job): Promise<ScreeningTarget[]> {
    const wfList = await this.workflowService.findByIds((job.workflows ?? []) as mongoose.Types.ObjectId[]);
    const targets: ScreeningTarget[] = [];

    for (const wf of wfList) {
      const wfMongoId = String(wf._id);
      const nodeIds = (wf.nodes ?? []).map((n: unknown) => String((n as { _id?: unknown })._id ?? n));
      const nodes = await this.workflowNodeService.getByIDs(nodeIds);
      const byId = new Map(nodes.map((n) => [String(n._id), n]));

      for (const nid of nodeIds) {
        const node = byId.get(nid);
        if (!node?.service) continue;
        const svc = await this.dampLabServices.findOne(String(node.service));
        if (!svc) continue;

        const multi = getMultiValueParamIds(svc.parameters);
        const entries = normalizeFormDataToArray(node.formData, multi);

        if (svc.name === GIBSON_ASSEMBLY_SERVICE_NAME) {
          const seq = getFormStringFromEntries(entries, 'insert');
          if (seq) targets.push({ name: `${wfMongoId}_${node.id}_insert`, seq });
        } else if (svc.name === M_CLONING_SERVICE_NAME) {
          for (const field of ['vector', 'insert'] as const) {
            const seq = getFormStringFromEntries(entries, field);
            if (seq) targets.push({ name: `${wfMongoId}_${node.id}_${field}`, seq });
          }
        }
      }
    }

    return targets;
  }

  async getJobScreeningStatus(job: Job): Promise<JobScreeningStatus> {
    const expected = await this.collectScreeningTargets(job);
    const requiresScreening = expected.length > 0;
    const targetSequenceCount = expected.length;

    const ids = (job.screeningBatchIds ?? []).map((x) => String(x));
    const hasScreeningBatch = ids.length > 0;

    if (!requiresScreening) {
      return {
        requiresScreening: false,
        targetSequenceCount: 0,
        hasScreeningBatch,
        sequencesCurrent: true,
        screeningPassed: true,
        allowStaffActions: true,
        blockingMessage: null
      };
    }

    const latest = await this.getLatestBatchForJob(ids);
    if (!latest) {
      return {
        requiresScreening: true,
        targetSequenceCount,
        hasScreeningBatch: false,
        sequencesCurrent: false,
        screeningPassed: false,
        allowStaffActions: false,
        blockingMessage: 'Run sequence screening before generating a SOW or accepting the job.'
      };
    }

    const sequencesCurrent = this.batchMatchesExpected(latest, expected);
    const errors = (latest as { errors?: { length?: number } }).errors ?? [];
    const screeningPassed =
      String((latest as { synthesisPermission?: string }).synthesisPermission) === 'granted' &&
      (!Array.isArray(errors) || errors.length === 0);

    let blockingMessage: string | null = null;
    if (!sequencesCurrent) {
      blockingMessage = 'Sequences changed since the last screening. Run screening again.';
    } else if (!screeningPassed) {
      blockingMessage = 'Screening did not grant synthesis or reported errors. Review hazards before proceeding.';
    }

    const allowStaffActions = sequencesCurrent && screeningPassed;

    return {
      requiresScreening: true,
      targetSequenceCount,
      hasScreeningBatch: true,
      sequencesCurrent,
      screeningPassed,
      allowStaffActions,
      blockingMessage
    };
  }

  async screenJobSequences(jobId: string, userSub: string): Promise<ScreeningBatch> {
    const job = await this.jobService.findById(jobId);
    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const targets = await this.collectScreeningTargets(job);
    if (targets.length === 0) {
      throw new BadRequestException('No gibson-assembly or m-cloning sequences to screen on this job');
    }
    if (targets.length > MAX_MPI_SEQUENCE_BATCH) {
      throw new BadRequestException(`Too many sequences for one screening batch (max ${MAX_MPI_SEQUENCE_BATCH})`);
    }

    const upserted: Sequence[] = [];
    for (const t of targets) {
      upserted.push(await this.mpiService.upsertSequenceForScreening(t.name, t.seq, userSub));
    }

    const providerReference = `${job._id}_${Date.now()}`;
    const batch = await this.mpiService.screenSequencesBatch(
      {
        sequenceIds: upserted.map((s) => String(s.id)),
        region: Region.ALL,
        providerReference
      },
      userSub
    );

    const batchId = batch.id;
    if (batchId) {
      await this.jobService.appendScreeningBatchId(jobId, new mongoose.Types.ObjectId(batchId));
    }

    return batch;
  }

  async getJobScreeningBatchDisplay(job: Job): Promise<JobScreeningBatchDisplay | null> {
    const ids = (job.screeningBatchIds ?? []).map((x) => String(x));
    if (!ids.length) return null;

    const latest = await this.getLatestBatchForJob(ids);
    if (!latest) return null;

    const expected = await this.collectScreeningTargets(job);
    const sequencesCurrent = expected.length === 0 ? true : this.batchMatchesExpected(latest, expected);

    const rawSlices = (latest.sequences as Array<Record<string, unknown>>) ?? [];
    const slices: JobScreeningSliceResult[] = [];
    for (const s of rawSlices) {
      const sliceName = String(s.name ?? '');
      const parsed = parseScreeningSliceName(sliceName);
      if (!parsed) continue;
      slices.push({
        sliceName,
        workflowId: parsed.workflowId,
        nodeId: parsed.nodeId,
        fieldId: parsed.fieldId,
        order: Number(s.order ?? 0),
        originalSeq: s.originalSeq != null ? String(s.originalSeq) : null,
        threats: Array.isArray(s.threats) ? s.threats : [],
        warning: s.warning != null ? String(s.warning) : null
      });
    }

    const errors = (latest.errors as unknown[]) ?? [];
    const warnings = (latest.warnings as unknown[]) ?? [];

    return {
      batchId: String(latest._id ?? ''),
      synthesisPermission: String((latest as { synthesisPermission?: string }).synthesisPermission ?? ''),
      mpiCreatedAt: new Date((latest as { mpiCreatedAt?: Date | string }).mpiCreatedAt ?? 0),
      screenedAt: new Date((latest as { createdAt?: Date | string }).createdAt ?? 0),
      sequencesCurrent,
      batchErrorCount: Array.isArray(errors) ? errors.length : 0,
      batchWarningCount: Array.isArray(warnings) ? warnings.length : 0,
      slices
    };
  }

  private async getLatestBatchForJob(screeningBatchIds: string[]): Promise<Record<string, unknown> | null> {
    if (!screeningBatchIds.length) return null;
    const oids = screeningBatchIds.map((id) => new mongoose.Types.ObjectId(id));
    const doc = await this.screeningBatchModel.findOne({ _id: { $in: oids } }).sort({ createdAt: -1 }).lean().exec();
    return doc as Record<string, unknown> | null;
  }

  private batchMatchesExpected(batch: Record<string, unknown>, expected: ScreeningTarget[]): boolean {
    const expMap = new Map(expected.map((x) => [x.name, normalizeSequenceString(x.seq)]));
    const slices = (batch.sequences as Array<{ name?: string; originalSeq?: string }>) ?? [];
    const byName = new Map<string, string>();
    for (const s of slices) {
      if (s.name) {
        byName.set(s.name, normalizeSequenceString(String(s.originalSeq ?? '')));
      }
    }
    if (byName.size !== expMap.size) return false;
    for (const [name, seq] of expMap) {
      if (byName.get(name) !== seq) return false;
    }
    return true;
  }
}
