import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BundleEdge, BundleEdgeDocument } from '../models/edge.model';
import { AddBundleEdgeInput } from '../dtos/add-edge.input';

@Injectable()
export class BundleEdgeService {
  constructor(@InjectModel(BundleEdge.name) private readonly BundleEdgeModel: Model<BundleEdgeDocument>) {}

  /**
   * Remove all edges whose ID is in the given list
   */
  async removeByIDs(ids: string[]): Promise<void> {
    await this.BundleEdgeModel.deleteMany({ _id: { $in: ids } });
  }

  /**
   * Create a new edge. A map is provided which is used to convert
   * the Bundle IDs to the database IDs for the source and target
   * nodes
   */
  async create(newEdge: AddBundleEdgeInput, nodeIDMap: Map<string, string>): Promise<BundleEdge> {
    const edge = { ...newEdge };

    // Make sure the source and target are valid
    const sourceDBID = nodeIDMap.get(edge.source);
    if (!sourceDBID) {
      throw new Error(`Invalid source node ID: ${edge.source}`);
    }
    const destDBID = nodeIDMap.get(edge.target);
    if (!destDBID) {
      throw new Error(`Invalid target node ID: ${edge.target}`);
    }

    edge.source = sourceDBID;
    edge.target = destDBID;
    return this.BundleEdgeModel.create(edge);
  }

  /**
   * Get all edges whose ID is in the given list
   */
  async getByIDs(ids: string[]): Promise<BundleEdge[]> {
    return this.BundleEdgeModel.find({ _id: { $in: ids } });
  }
}
