import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Bundle } from './models/bundle.model';
import { Model } from 'mongoose';
import { UpdateBundleInput } from './dtos/update.dto';
import { CreateBundleInput } from './dtos/create.dto';
import { BundleNodeService } from './services/node.service'
import { BundleEdgeService } from './services/edge.service'
import { DampLabServices } from './../services/damplab-services.services';

@Injectable()
export class BundlesService {
  constructor(
    @InjectModel(Bundle.name) private readonly bundleModel: Model<Bundle>,
      private readonly nodeService: BundleNodeService,
      private readonly edgeService: BundleEdgeService,
      private readonly damplabServices: DampLabServices
  ) {}

  async find(id: string): Promise<Bundle | null> {
    return this.bundleModel.findById(id);
  }

  async findAll(): Promise<Bundle[]> {
    return this.bundleModel.find().exec();
  }

  // Private helper: create nodes and edges, return their ObjectIds
  private async createNodesAndEdges(bundle: CreateBundleInput | UpdateBundleInput) {
    // Step 1: Create nodes
    const createdNodes = await Promise.all(
      (bundle.nodes ?? []).map(async nodeInput => {
        const service = await this.damplabServices.findOne(nodeInput.serviceId);
        if (!service) {
          throw new Error(`Could not find service with ID ${nodeInput.serviceId}`);
        }
        return this.nodeService.create({ ...nodeInput, service });
      })
    );

    const nodeIdMap: Record<string, string> = {};
    createdNodes.forEach(node => {
      nodeIdMap[node.id] = node._id.toString();
    });

    // Step 2: Create edges using ObjectId references
    const createdEdges = await Promise.all(
      (bundle.edges ?? []).map(edgeInput =>
        this.edgeService.create({
          ...edgeInput,
          source: nodeIdMap[edgeInput.source],
          target: nodeIdMap[edgeInput.target],
        })
      )
    );

    return {
      nodes: createdNodes,
      edges: createdEdges,
      nodeIdMap,
    };
  }

  // Original create method now delegates
  async create(bundle: CreateBundleInput): Promise<Bundle> {
    const { nodes, edges } = await this.createNodesAndEdges(bundle);
    return this.bundleModel.create({
      ...bundle,
      nodes: nodes.map(n => n._id),
      edges: edges.map(e => e._id),
    });
  }

  // Updated update method
  async update(bundle: Bundle, changes: UpdateBundleInput): Promise<Bundle> {
    // Step 1: Delete previous nodes and edges
    await Promise.all([
      this.nodeService.removeByIDs(bundle.nodes.map(n => n._id.toString())),
      this.edgeService.removeByIDs(bundle.edges.map(e => e._id.toString())),
    ]);

    // Step 2: Use the helper to create new nodes and edges
    const { nodes, edges } = await this.createNodesAndEdges(changes);

    // Step 3: Update the bundle document with new node/edge references
    await this.bundleModel.updateOne({ _id: bundle.id }, {
      ...changes,
      nodes: nodes.map(n => n._id),
      edges: edges.map(e => e._id),
    });

    return (await this.find(bundle.id))!;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.bundleModel.deleteOne({ _id: id });
    return result.deletedCount > 0;
  };
}
