import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Job, JobDocument } from './job.model';
import { Model } from 'mongoose';
import { CreateJobFull } from './job.dto';
import {Workflow} from 'src/workflow/models/workflow.model';

@Injectable()
export class JobService {
  constructor(@InjectModel(Job.name) private readonly jobModel: Model<JobDocument>) {}

  async create(createJobInput: CreateJobFull): Promise<Job> {
    return this.jobModel.create(createJobInput);
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
}
