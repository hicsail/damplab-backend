import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Job, JobAttachment, JobDocument, JobState, CustomerCategory } from './job.model';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { CreateJobFull } from './job.dto';
import { Workflow } from '../workflow/models/workflow.model';
import { WorkflowService } from '../workflow/workflow.service';
import { OwnJobsInput, AllJobsInput, OwnJobsResult, JobsResult, JobSortField, SortOrder } from './dto/jobs-query.dto';
import { JobFeedStatus, JobFeedStatusEntity, JobFeedStatusEntityDocument } from './job-feed-status.model';
import { AddWorkflowInputFull } from '../workflow/dtos/add-workflow.input';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class JobService {
  constructor(
    @InjectModel(Job.name) private readonly jobModel: Model<JobDocument>,
    @InjectModel(JobFeedStatusEntity.name) private readonly jobFeedStatusModel: Model<JobFeedStatusEntityDocument>,
    @Inject(forwardRef(() => WorkflowService)) private readonly workflowService: WorkflowService
  ) {}
  private readonly logger = new Logger(JobService.name);

  async create(createJobInput: CreateJobFull): Promise<Job> {
    const workflowIDs = await Promise.all(
      createJobInput.workflows.map(async (workflow) => {
        const createdWorkflow = await this.workflowService.create(workflow);
        return createdWorkflow._id;
      })
    );

    // Generate a customer-facing 5-digit numeric jobId (e.g., "04217").
    // Note: This is separate from Mongo _id and is used only for display/reference.
    const pad5 = (n: number): string => String(n).padStart(5, '0');
    const nextJobId = async (): Promise<string> => {
      const latest = await this.jobModel
        .findOne({ jobId: { $exists: true, $ne: null } }, { jobId: 1 }, { sort: { jobId: -1 } })
        .lean()
        .exec();
      const latestNum = latest?.jobId && /^\d+$/.test(String(latest.jobId)) ? Number(latest.jobId) : 0;
      return pad5(latestNum + 1);
    };

    for (let attempt = 0; attempt < 5; attempt++) {
      const jobId = await nextJobId();
      try {
        return await this.jobModel.create({ ...createJobInput, jobId, workflows: workflowIDs, submitted: new Date() });
      } catch (err: any) {
        // Retry on duplicate key (race condition).
        const code = err?.code;
        if (code === 11000) {
          continue;
        }
        throw err;
      }
    }
    // If we still collide repeatedly, fall back to a random 5-digit value (still unique-index protected).
    // This is extremely unlikely; if it happens, it indicates heavy concurrent submissions.
    const fallback = pad5(Math.floor(Math.random() * 100000));
    return this.jobModel.create({ ...createJobInput, jobId: fallback, workflows: workflowIDs, submitted: new Date() });
  }

  async findAll(): Promise<Job[]> {
    return this.jobModel.find().exec();
  }

  async findBySub(sub: string): Promise<Job[]> {
    return this.jobModel.find({ sub: sub }).exec();
  }

  async findById(id: string): Promise<Job | null> {
    return this.jobModel.findById(id);
  }

  async findByName(name: string): Promise<Job | null> {
    return this.jobModel.findOne({ name });
  }

  async findByWorkflow(workflow: Workflow): Promise<Job | null> {
    return this.jobModel.findOne({ workflows: workflow._id });
  }

  /** Workflow IDs that belong to jobs accepted by technicians (ACCEPTED or later in pipeline). */
  async getWorkflowIdsForApprovedJobs(): Promise<mongoose.Types.ObjectId[]> {
    const approvedStates = [JobState.ACCEPTED, JobState.WAITING_FOR_SOW, JobState.QUEUED, JobState.IN_PROGRESS, JobState.COMPLETE];
    const jobs = await this.jobModel
      .find({ state: { $in: approvedStates } })
      .select('workflows')
      .lean()
      .exec();
    const ids = jobs.flatMap((j) => (j.workflows ?? []) as mongoose.Types.ObjectId[]);
    return [...new Set(ids)];
  }

  async updateState(job: Job, newState: JobState): Promise<Job | null> {
    return this.jobModel.findOneAndUpdate({ _id: job._id }, { $set: { state: newState } }, { new: true }).exec();
  }

  async updateCustomerCategory(jobId: string, customerCategory: CustomerCategory): Promise<Job | null> {
    return this.jobModel.findOneAndUpdate({ _id: jobId }, { $set: { customerCategory } }, { new: true }).exec();
  }

  async appendScreeningBatchId(jobId: string, screeningBatchId: mongoose.Types.ObjectId): Promise<Job | null> {
    return this.jobModel
      .findOneAndUpdate({ _id: jobId }, { $push: { screeningBatchIds: screeningBatchId } }, { new: true })
      .exec();
  }

  async addAttachments(jobId: string, attachments: JobAttachment[]): Promise<Job | null> {
    this.logger.log(`addAttachments called for jobId=${jobId} with ${attachments.length} attachment(s)`);
    this.logger.debug(`Attachments payload: ${JSON.stringify(attachments)}`);
    return this.jobModel
      .findOneAndUpdate(
        { _id: jobId },
        {
          $push: {
            attachments: {
              $each: attachments.map((a) => ({
                filename: a.filename,
                key: a.key,
                contentType: a.contentType,
                size: a.size,
                uploadedAt: a.uploadedAt ?? new Date()
              }))
            }
          }
        },
        { new: true }
      )
      .exec();
  }

  /**
   * Append a newly-created workflow to an existing job.
   * Intended for staff/technicians to update job scope as requirements change.
   */
  async addWorkflow(jobId: string, workflowInput: AddWorkflowInputFull): Promise<Job | null> {
    const createdWorkflow = await this.workflowService.create(workflowInput);
    return this.jobModel.findOneAndUpdate({ _id: jobId }, { $push: { workflows: createdWorkflow._id } }, { new: true }).exec();
  }

  /**
   * Build $match stage for search (case-insensitive regex on name, username, email, institute; optional _id exact match).
   */
  private buildSearchMatch(search: string): mongoose.FilterQuery<JobDocument> {
    const esc = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc, 'i');
    const or: mongoose.FilterQuery<JobDocument>[] = [{ name: re }, { username: re }, { email: re }, { institute: re }];
    if (/^[a-fA-F0-9]{24}$/.test(search)) {
      try {
        or.push({ _id: new mongoose.Types.ObjectId(search) });
      } catch {
        /* ignore */
      }
    }
    return { $or: or };
  }

  /**
   * Run paginated jobs query with filters, sort, and hasSow via $lookup.
   */
  private async runJobsPipeline(baseMatch: mongoose.FilterQuery<JobDocument>, input: OwnJobsInput | AllJobsInput): Promise<{ items: Job[]; totalCount: number }> {
    const page = Math.max(1, input.page ?? DEFAULT_PAGE);
    const limit = Math.min(MAX_LIMIT, Math.max(1, input.limit ?? DEFAULT_LIMIT));
    const skip = (page - 1) * limit;
    const sortBy = input.sortBy ?? JobSortField.SUBMITTED;
    const sortOrder = input.sortOrder ?? SortOrder.DESC;
    const sortDir: 1 | -1 = sortOrder === SortOrder.ASC ? 1 : -1;
    const sortField = sortBy === JobSortField.NAME ? 'name' : 'submitted';

    const match: mongoose.FilterQuery<JobDocument>[] = [baseMatch];
    if (input.search?.trim()) {
      match.push(this.buildSearchMatch(input.search.trim()));
    }
    if (input.state != null) {
      match.push({ state: input.state });
    }

    const lookup = {
      $lookup: {
        from: 'sows',
        localField: '_idStr',
        foreignField: 'jobId',
        as: '_sowDocs'
      }
    };
    const addIdStr = { $addFields: { _idStr: { $toString: '$_id' } } };
    const addHasSow = { $addFields: { _hasSow: { $gt: [{ $size: '$_sowDocs' }, 0] } } };
    const hasSowMatch = input.hasSow === true ? [{ $match: { _hasSow: true } }] : input.hasSow === false ? [{ $match: { _hasSow: false } }] : [];
    const project = { $project: { _sowDocs: 0, _hasSow: 0, _idStr: 0 } };

    const sortStage = { $sort: { [sortField]: sortDir } as Record<string, 1 | -1> };
    const facet = {
      $facet: {
        totalCount: [{ $count: 'n' }],
        items: [project, sortStage, { $skip: skip }, { $limit: limit }]
      }
    };

    const pipeline: mongoose.PipelineStage[] = [{ $match: match.length === 1 ? match[0] : { $and: match } }, addIdStr, lookup, addHasSow, ...hasSowMatch, facet];

    const raw = await this.jobModel.aggregate(pipeline).exec();
    const totalCount = raw[0]?.totalCount[0]?.n ?? 0;
    const items = (raw[0]?.items ?? []) as Job[];

    return { items, totalCount };
  }

  async findOwnJobsPaginated(sub: string, input: OwnJobsInput): Promise<OwnJobsResult> {
    const baseMatch = { sub };
    const { items, totalCount } = await this.runJobsPipeline(baseMatch, input);
    return { items, totalCount };
  }

  async findAllJobsPaginated(input: AllJobsInput): Promise<JobsResult> {
    const { items, totalCount } = await this.runJobsPipeline({}, input);
    return { items, totalCount };
  }

  private async latestSubmittedAt(): Promise<Date | null> {
    const latestBySubmitted = await this.jobModel
      .findOne({}, { submitted: 1 }, { sort: { submitted: -1 } })
      .lean()
      .exec();
    const latestByCreated = await this.jobModel
      .findOne({}, { _id: 1 }, { sort: { _id: -1 } })
      .lean()
      .exec();
    const submittedAt = latestBySubmitted?.submitted ? new Date(latestBySubmitted.submitted) : null;
    const createdAt = latestByCreated?._id ? new mongoose.Types.ObjectId(String(latestByCreated._id)).getTimestamp() : null;
    if (submittedAt && createdAt) {
      return submittedAt > createdAt ? submittedAt : createdAt;
    }
    return submittedAt ?? createdAt ?? null;
  }

  async getJobsFeedStatus(): Promise<JobFeedStatus> {
    const [latestSubmittedAt, statusDoc] = await Promise.all([this.latestSubmittedAt(), this.jobFeedStatusModel.findOne({ key: 'global' }).lean().exec()]);
    const viewedAt = statusDoc?.viewedAt ?? null;
    const hasUnseen = Boolean(latestSubmittedAt && (!viewedAt || latestSubmittedAt > viewedAt));
    return {
      viewedAt,
      latestSubmittedAt,
      hasUnseen
    };
  }

  async markJobsFeedViewed(now: Date = new Date()): Promise<JobFeedStatus> {
    await this.jobFeedStatusModel.findOneAndUpdate({ key: 'global' }, { $set: { viewedAt: now } }, { upsert: true, new: true }).exec();
    const latestSubmittedAt = await this.latestSubmittedAt();
    return {
      viewedAt: now,
      latestSubmittedAt,
      hasUnseen: Boolean(latestSubmittedAt && latestSubmittedAt > now)
    };
  }
}
