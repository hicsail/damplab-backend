import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BundleNode, BundleNodeDocument } from '../models/node.model';
import { AddNodeInputFull } from '../dtos/add-node.input';

@Injectable()
export class BundleNodeService {
  constructor(@InjectModel(BundleNode.name) private readonly BundleNodeModel: Model<BundleNodeDocument>) {}

  async create(newNode: AddNodeInputFull): Promise<BundleNode> {
    // TODO: Ensure the fields are valid
    const node = { ...newNode, service: newNode.service._id };
    return this.BundleNodeModel.create(node);
  }

  async getByID(id: string): Promise<BundleNode | null> {
    return this.BundleNodeModel.findById(id);
  }

  /**
   * Remove all nodes whose ID is in the given list
   */
  async removeByIDs(ids: string[]): Promise<void> {
    await this.BundleNodeModel.deleteMany({ _id: { $in: ids } });
  }

  /**
   * Get all nodes whose ID is in the given list
   */
  async getByIDs(ids: string[]): Promise<BundleNode[]> {
    return this.BundleNodeModel.find({ _id: { $in: ids } });
  }
}
