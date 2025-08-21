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

  async create(bundle: CreateBundleInput): Promise<Bundle>{
    // Step 1: Create nodes
    const createdNodes = await Promise.all(
      (bundle.nodes ?? []).map(async nodeInput => {
        // Find service document for the serviceId
        const service = await this.damplabServices.findOne(nodeInput.serviceId);
        if (!service) {
          throw new Error(`Could not find service with ID ${nodeInput.serviceId}`);
        }

        // Create a new node with the internal id from input
        return this.nodeService.create({
          ...nodeInput,
          service,
        });
      })
    );

    // Step 2: Map internal IDs to Mongo ObjectIds
    const nodeIdMap: Record<string, string> = {};
    createdNodes.forEach(node => {
      nodeIdMap[node.id] = node._id.toString(); // map internal id -> ObjectId
    });

    // Step 3: Create edges using ObjectId references
    const createdEdges = await Promise.all(
      (bundle.edges ?? []).map(edgeInput =>
        this.edgeService.create({
          ...edgeInput,
          source: nodeIdMap[edgeInput.source],
          target: nodeIdMap[edgeInput.target],
        })
      )
    );

    // Step 4: Save the bundle
    return this.bundleModel.create({
      ...bundle,
      nodes: createdNodes.map(n => n._id),
      edges: createdEdges.map(e => e._id),
    });
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.bundleModel.deleteOne({ _id: id });
    return result.deletedCount > 0;
  };

  async update(bundle: Bundle, changes: UpdateBundleInput): Promise<Bundle> {
    await this.bundleModel.updateOne({ _id: bundle.id }, changes);
    return (await this.find(bundle.id))!;
  }
}
