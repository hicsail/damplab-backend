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
    // Create nodes
    const createdNodes = await Promise.all(
      (bundle.nodes ?? []).map(async nodeInput => {
        const service = await this.damplabServices.findOne(nodeInput.serviceId);
        if (!service) {
          throw new Error(`Could not find service with ID ${nodeInput.serviceId}`);
        }
        const createdNode = await this.nodeService.create({ ...nodeInput, service });
        return { createdNode, tempId: nodeInput.id }; // Keep track of tempId to map to db ids
      })
    );

    // Mapping
    const nodeIdMap: Record<string, string> = {};
    createdNodes.forEach(({createdNode, tempId}) => {
      nodeIdMap[tempId] = createdNode._id.toString();
    });

    // Create edges using ObjectId references
    const createdEdges = await Promise.all(
      (bundle.edges ?? []).map(edgeInput =>
        this.edgeService.create({
          ...edgeInput,
          source: nodeIdMap[edgeInput.source],
          target: nodeIdMap[edgeInput.target],
        })
      )
    );
    return { nodes: createdNodes.map(n => n.createdNode), edges: createdEdges };
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

  async update(bundle: Bundle, changes: UpdateBundleInput): Promise<Bundle> {
    // Delete previous nodes and edges
    await Promise.all([
      this.nodeService.removeByIDs(bundle.nodes.map(n => n._id.toString())),
      this.edgeService.removeByIDs(bundle.edges.map(e => e._id.toString())),
    ]);

    const { nodes, edges } = await this.createNodesAndEdges(changes);

    // Update the bundle document to new node/edge references
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
