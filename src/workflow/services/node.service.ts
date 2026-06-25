import { BadRequestException, Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { WorkflowNode, WorkflowNodeDocument, WorkflowNodeState } from '../models/node.model';
import { AddNodeInputFull } from '../dtos/add-node.input';
import { Workflow, WorkflowDocument } from '../models/workflow.model';
import { JobService } from '../../job/job.service';
import { Job } from '../../job/job.model';

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
    // Auto-release inventory when leaving IN_PROGRESS. Going back to QUEUED
    // also releases (staff might undo a mistaken start). Going to COMPLETE
    // releases as well — the work is done.
    if (newState !== WorkflowNodeState.IN_PROGRESS) {
      update.usedInventory = [];
    }
    return this.workflowNodeModel.findOneAndUpdate({ _id: node._id }, { $set: update }, { new: true });
  }

  /**
   * Set the inventory items a node is holding. Enforces exclusivity: rejects
   * if any of the requested items is already held by a different IN_PROGRESS
   * node. Caller is expected to have already verified the node itself is in
   * IN_PROGRESS (UI hides the picker otherwise).
   */
  async setUsedInventory(node: WorkflowNode, inventoryIds: string[]): Promise<WorkflowNode | null> {
    const oids = (inventoryIds || []).map((id) => new mongoose.Types.ObjectId(id));
    if (oids.length > 0) {
      const conflicts = await this.workflowNodeModel
        .find({
          _id: { $ne: node._id },
          state: WorkflowNodeState.IN_PROGRESS,
          usedInventory: { $in: oids }
        })
        .select('_id label usedInventory')
        .lean()
        .exec();
      if (conflicts.length > 0) {
        const heldIds = new Set<string>();
        for (const c of conflicts) {
          for (const i of (c.usedInventory ?? []) as mongoose.Types.ObjectId[]) {
            if (oids.some((o) => o.equals(i))) heldIds.add(String(i));
          }
        }
        throw new BadRequestException(
          `Inventory item(s) already in use by another in-progress node: ${[...heldIds].join(', ')}`
        );
      }
    }
    return this.workflowNodeModel
      .findOneAndUpdate({ _id: node._id }, { $set: { usedInventory: oids } }, { new: true })
      .exec();
  }

  /** All in-progress nodes that currently hold any inventory (for the availability board). */
  async getInProgressNodesHoldingInventory(): Promise<WorkflowNode[]> {
    return this.workflowNodeModel
      .find({ state: WorkflowNodeState.IN_PROGRESS, usedInventory: { $exists: true, $ne: [] } })
      .exec();
  }

  async updateAssignee(node: WorkflowNode, assigneeId: string | null, assigneeDisplayName: string | null): Promise<WorkflowNode | null> {
    return this.workflowNodeModel.findOneAndUpdate({ _id: node._id }, { $set: { assigneeId: assigneeId ?? undefined, assigneeDisplayName: assigneeDisplayName ?? undefined } }, { new: true });
  }

  async updateEstimatedMinutes(node: WorkflowNode, estimatedMinutes: number | null): Promise<WorkflowNode | null> {
    return this.workflowNodeModel.findOneAndUpdate({ _id: node._id }, { $set: { estimatedMinutes: estimatedMinutes ?? undefined } }, { new: true });
  }

  /** All operations (nodes) assigned to a given user, for the technician bench view. */
  async getNodesByAssignee(assigneeId: string): Promise<WorkflowNode[]> {
    if (!assigneeId) return [];
    return this.workflowNodeModel.find({ assigneeId }).exec();
  }

  /** Persist the protocols.io step ids a technician has checked off for an operation. */
  async setCompletedSteps(node: WorkflowNode, completedSteps: string[]): Promise<WorkflowNode | null> {
    const unique = Array.from(new Set((completedSteps ?? []).map((s) => String(s))));
    return this.workflowNodeModel.findOneAndUpdate({ _id: node._id }, { $set: { completedSteps: unique } }, { new: true }).exec();
  }

  /** Find the job a node belongs to (node -> workflow -> job), for bench-view context + note scoping. */
  async getJobForNode(nodeId: string): Promise<Job | null> {
    const workflow = await this.workflowModel.findOne({ nodes: nodeId }).exec();
    if (!workflow) return null;
    return this.jobService.findByWorkflow(workflow as unknown as Workflow);
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
