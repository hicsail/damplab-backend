import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WorkflowNode, WorkflowNodeDocument } from '../models/node.model';
import { AddNodeInput } from '../dtos/add-node.input';

@Injectable()
export class WorkflowNodeService {
  constructor(@InjectModel(WorkflowNode.name) private readonly workflowNodeModel: Model<WorkflowNodeDocument>) {}

  async create(newNode: AddNodeInput): Promise<WorkflowNode> {
    // TODO: Ensure the fields are valid
    return this.workflowNodeModel.create(newNode);
  }

  async getByID(id: string): Promise<WorkflowNode | null> {
    return this.workflowNodeModel.findById(id);
  }

  /**
   * Remove all nodes whose ID is in the given list
   */
  async removeByIDs(ids: string[]): Promise<void> {
    await this.workflowNodeModel.deleteMany({ _id: { $in: ids } });
  }

  /**
   * Get all nodes whose ID is in the given list
   */
  async getByIDs(ids: string[]): Promise<WorkflowNode[]> {
    return this.workflowNodeModel.find({ _id: { $in: ids } });
  }
}
