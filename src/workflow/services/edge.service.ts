import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WorkflowEdge, WorkflowEdgeDocument } from '../models/edge.model';
import { AddEdgeInput } from '../dtos/add-edge.input';

@Injectable()
export class WorkflowEdgeService {
  constructor(@InjectModel(WorkflowEdge.name) private readonly workflowEdgeModel: Model<WorkflowEdgeDocument>) {}

  /**
   * Remove all edges whose ID is in the given list
   */
  async removeByIDs(ids: string[]): Promise<void> {
    await this.workflowEdgeModel.deleteMany({ _id: { $in: ids } });
  }

  /**
   * Create a new edge. A map is provided which is used to convert
   * the workflow IDs to the database IDs for the source and destination
   * nodes
   */
  async create(newEdge: AddEdgeInput, nodeIDMap: Map<string, string>): Promise<WorkflowEdge> {
    const edge = { ...newEdge };

    // Make sure the source and destination are valid
    const sourceDBID = nodeIDMap.get(edge.source);
    if (!sourceDBID) {
      throw new Error(`Invalid source node ID: ${edge.source}`);
    }
    const destDBID = nodeIDMap.get(edge.destination);
    if (!destDBID) {
      throw new Error(`Invalid destination node ID: ${edge.destination}`);
    }

    edge.source = sourceDBID;
    edge.destination = destDBID;
    return this.workflowEdgeModel.create(edge);
  }

  /**
   * Get all edges whose ID is in the given list
   */
  async getByIDs(ids: string[]): Promise<WorkflowEdge[]> {
    return this.workflowEdgeModel.find({ _id: { $in: ids } });
  }
}
