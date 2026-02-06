import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Job, JobDocument, JobState } from './job.model';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { CreateJobFull } from './job.dto';
import { Workflow } from '../workflow/models/workflow.model';
import { WorkflowService } from '../workflow/workflow.service';
import { OwnJobsInput, AllJobsInput, OwnJobsResult, JobsResult, JobSortField, SortOrder } from './dto/jobs-query.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Injectable()
export class JobService {
  constructor(@InjectModel(Job.name) private readonly jobModel: Model<JobDocument>, private readonly workflowService: WorkflowService) {}

  async create(createJobInput: CreateJobFull): Promise<Job> {
    const workflowIDs = await Promise.all(
      createJobInput.workflows.map(async (workflow) => {
        const createdWorkflow = await this.workflowService.create(workflow);
        return createdWorkflow._id;
      })
    );
    return this.jobModel.create({ ...createJobInput, workflows: workflowIDs });
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

  async updateState(job: Job, newState: JobState): Promise<Job | null> {
    return this.jobModel.findOneAndUpdate({ _id: job._id }, { $set: { state: newState } }, { new: true }).exec();
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
}
