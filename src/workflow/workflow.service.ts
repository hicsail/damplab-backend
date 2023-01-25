import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Workflow, WorkflowDocument, WorkflowState } from './models/workflow.model';
import { AddWorkflowInput } from './dtos/add-workflow.input';
import { WorkflowNodeService } from './services/node.service';
import { WorkflowEdgeService } from './services/edge.service';
import { UpdateWorkflowStateFull } from './dtos/update-state.input';

@Injectable()
export class WorkflowService {
  constructor(
    @InjectModel(Workflow.name) private readonly workflowModel: Model<WorkflowDocument>,
    private readonly nodeService: WorkflowNodeService,
    private readonly edgeService: WorkflowEdgeService
  ) {}

  async create(createWorkflowInput: AddWorkflowInput): Promise<Workflow> {
    // Make the nodes
    const nodes = await Promise.all(createWorkflowInput.nodes.map((node) => this.nodeService.create(node)));

    // Get the mapping between workflow IDs and the database IDs
    const nodeIDMap = new Map<string, string>();
    for (const node of nodes) {
      nodeIDMap.set(node.id, node._id);
    }

    // Make the edges
    const edges = await Promise.all(createWorkflowInput.edges.map((edge) => this.edgeService.create(edge, nodeIDMap)));

    const workflow = { ...createWorkflowInput, nodes, edges, state: WorkflowState.SUBMITTED };

    return this.workflowModel.create(workflow);
  }

  async findById(id: string): Promise<Workflow | null> {
    return this.workflowModel.findById(id);
  }

  async findOne(id: string): Promise<Workflow | null> {
    return this.workflowModel.findById(id);
  }

  async updateState(updateWorkflowState: UpdateWorkflowStateFull): Promise<Workflow> {
    await this.workflowModel.updateOne({ _id: updateWorkflowState.workflow._id }, { state: updateWorkflowState.state }).exec();
    const result = await this.workflowModel.findOne({ _id: updateWorkflowState.workflow._id });
    return result!;
  }

  async getByState(state: WorkflowState): Promise<Workflow[]> {
    return this.workflowModel.find({ state });
  }
}
