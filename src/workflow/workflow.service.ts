import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { Workflow, WorkflowDocument, WorkflowState } from './models/workflow.model';
import { AddWorkflowInputFull } from './dtos/add-workflow.input';
import { WorkflowNodeService } from './services/node.service';
import { WorkflowEdgeService } from './services/edge.service';

@Injectable()
export class WorkflowService {
  constructor(
    @InjectModel(Workflow.name) private readonly workflowModel: Model<WorkflowDocument>,
    private readonly nodeService: WorkflowNodeService,
    private readonly edgeService: WorkflowEdgeService
  ) {}

  async create(createWorkflowInput: AddWorkflowInputFull): Promise<Workflow> {

    // Make the nodes
    const nodes = await Promise.all(createWorkflowInput.nodes.map((node) => this.nodeService.create(node)));

    // Get the mapping between workflow IDs and the database IDs
    const nodeIDMap = new Map<string, string>();
    for (const node of nodes) {
      nodeIDMap.set(node.id, node._id);
    }

    // Make the edges
    const edges = await Promise.all(createWorkflowInput.edges.map((edge) => this.edgeService.create(edge, nodeIDMap)));

    const workflow = { ...createWorkflowInput, nodes, edges, state: WorkflowState.QUEUED };

    return this.workflowModel.create(workflow);
  }

  async findById(id: string): Promise<Workflow | null> {
    return this.workflowModel.findById(id);
  }

  async findOne(id: string): Promise<Workflow | null> {
    return this.workflowModel.findById(id);
  }

  async updateState(workflow: Workflow, state: WorkflowState): Promise<Workflow | null> {
    return this.workflowModel.findOneAndUpdate({ _id: workflow._id }, { $set: { state: state } }, { new: true });
  }

  async getByState(state: WorkflowState): Promise<Workflow[]> {
    return this.workflowModel.find({ state });
  }

  async findByIds(ids: mongoose.Types.ObjectId[]): Promise<Workflow[]> {
    return this.workflowModel.find({ _id: { $in: ids } });
  }
}
