import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Workflow, WorkflowDocument } from './models/workflow.model';
import { AddWorkflowInput } from './dtos/add-workflow.input';
import { WorkflowNodeService } from './services/node.service';
import { WorkflowEdgeService } from './services/edge.service';

@Injectable()
export class WorkflowService {
  constructor(
    @InjectModel(Workflow.name) private readonly workflowModel: Model<WorkflowDocument>,
    private readonly nodeService: WorkflowNodeService,
    private readonly edgeService: WorkflowEdgeService
  ) {}

  async create(createWorkflowInput: AddWorkflowInput): Promise<Workflow> {
    // For now, if a workflow with the same name exists, we will just
    // remove the existing workflow and replace it with the new one.
    // TODO: Once the auth system is integrated, add in concept of a user
    const existingWorkflow = await this.findByName(createWorkflowInput.name);
    if (existingWorkflow) {
      await this.remove(existingWorkflow);
    }

    // Make the nodes
    const nodes = await Promise.all(createWorkflowInput.nodes.map((node) => this.nodeService.create(node)));

    // Get the mapping between workflow IDs and the database IDs
    const nodeIDMap = new Map<string, string>();
    for (const node of nodes) {
      nodeIDMap.set(node.id, node._id);
    }

    // Make the edges
    const edges = await Promise.all(createWorkflowInput.edges.map((edge) => this.edgeService.create(edge, nodeIDMap)));

    const workflow = { ...createWorkflowInput, nodes, edges };

    return this.workflowModel.create(workflow);
  }

  async findByName(name: string): Promise<Workflow | null> {
    return this.workflowModel.findOne({ name });
  }

  private async remove(workflow: Workflow): Promise<void> {
    // Remove all nodes
    const workflowNodes = workflow.nodes.map((node) => node._id.toString());
    await this.nodeService.removeByIDs(workflowNodes);

    // Remove all edges
    const workflowEdges = workflow.edges.map((edge) => edge._id.toString());
    await this.edgeService.removeByIDs(workflowEdges);

    // Remove the workflow
    await this.workflowModel.deleteOne({ _id: workflow._id });
  }
}
