import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Job, JobDocument, JobState } from './job.model';
import { Model } from 'mongoose';
import { CreateJobFull } from './job.dto';
import { Workflow } from '../workflow/models/workflow.model';
import { WorkflowService } from '../workflow/workflow.service';

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
}