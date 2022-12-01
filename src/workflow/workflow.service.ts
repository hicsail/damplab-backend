import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Workflow, WorkflowDocument } from './models/workflow.model';
import { AddWorkflowInput } from './dtos/add-workflow.input';

@Injectable()
export class WorkflowService {
  constructor(@InjectModel(Workflow.name) private readonly workflowModel: Model<WorkflowDocument>) {}

  async create(createWorkflowInput: AddWorkflowInput): Promise<Workflow> {
    return this.workflowModel.create(createWorkflowInput);
  }

  async findByName(name: string): Promise<Workflow | null> {
    return this.workflowModel.findOne({ name });
  }
}
