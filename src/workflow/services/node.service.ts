import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WorkflowNode, WorkflowNodeDocument, WorkflowNodeState } from '../models/node.model';
import { AddNodeInputFull } from '../dtos/add-node.input';
import { Workflow, WorkflowDocument } from '../models/workflow.model';
import { JobService } from '../../job/job.service';

@Injectable()
export class WorkflowNodeService {
  constructor(
    @InjectModel(WorkflowNode.name) private readonly workflowNodeModel: Model<WorkflowNodeDocument>,
    @InjectModel(Workflow.name) private readonly workflowModel: Model<WorkflowDocument>,
    @Inject(forwardRef(() => JobService)) private readonly jobService: JobService
  ) {}

  async create(newNode: AddNodeInputFull): Promise<WorkflowNode> {
    // TODO: Ensure the fields are valid
    const node = { ...newNode, service: newNode.service!._id };
    return this.workflowNodeModel.create(node);
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

  async updateState(node: WorkflowNode, newState: WorkflowNodeState): Promise<WorkflowNode | null> {
    const update: Record<string, unknown> = { state: newState };
    if (newState === WorkflowNodeState.IN_PROGRESS && !node.startedAt) {
      update.startedAt = new Date();
    }
    return this.workflowNodeModel.findOneAndUpdate({ _id: node._id }, { $set: update }, { new: true });
  }

  async updateAssignee(node: WorkflowNode, assigneeId: string | null, assigneeDisplayName: string | null): Promise<WorkflowNode | null> {
    return this.workflowNodeModel.findOneAndUpdate({ _id: node._id }, { $set: { assigneeId: assigneeId ?? undefined, assigneeDisplayName: assigneeDisplayName ?? undefined } }, { new: true });
  }

  async updateEstimatedMinutes(node: WorkflowNode, estimatedMinutes: number | null): Promise<WorkflowNode | null> {
    return this.workflowNodeModel.findOneAndUpdate({ _id: node._id }, { $set: { estimatedMinutes: estimatedMinutes ?? undefined } }, { new: true });
  }

  /** Nodes in this state that belong to workflows on approved jobs (for lab monitor by node state). */
  async getNodesByStateForApprovedJobs(nodeState: WorkflowNodeState): Promise<WorkflowNode[]> {
    const approvedWorkflowIds = await this.jobService.getWorkflowIdsForApprovedJobs();
    if (approvedWorkflowIds.length === 0) return [];
    const workflows = await this.workflowModel
      .find({ _id: { $in: approvedWorkflowIds } })
      .select('nodes')
      .lean()
      .exec();
    const nodeIds = workflows.flatMap((w) => (w.nodes ?? []).map((id) => id.toString()));
    if (nodeIds.length === 0) return [];
    return this.workflowNodeModel.find({ _id: { $in: nodeIds }, state: nodeState }).exec();
  }
}
