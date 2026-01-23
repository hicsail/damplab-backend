import { Injectable } from '@nestjs/common';
import { DampLabService, DampLabServiceDocument } from './models/damplab-service.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { ServiceChange } from './dtos/update.dto';
import { CreateService } from './dtos/create.dto';

@Injectable()
export class DampLabServices {
  constructor(@InjectModel(DampLabService.name) private readonly dampLabServiceModel: Model<DampLabServiceDocument>) {}

  /**
   * Ensure deliverables field is always an array (for backward compatibility)
   */
  private normalizeDeliverables(service: DampLabService): DampLabService {
    if (!service.deliverables) {
      service.deliverables = [];
    }
    return service;
  }

  async findAll(): Promise<DampLabService[]> {
    const services = await this.dampLabServiceModel.find().exec();
    return services.map((service) => this.normalizeDeliverables(service));
  }

  /**
   * Find a list of services by their IDs.
   */
  async findByIds(ids: mongoose.Types.ObjectId[]): Promise<DampLabService[]> {
    const services = await this.dampLabServiceModel.find({ _id: { $in: ids } }).exec();
    return services.map((service) => this.normalizeDeliverables(service));
  }

  async findOne(id: string): Promise<DampLabService | null> {
    const service = await this.dampLabServiceModel.findById(id).exec();
    return service ? this.normalizeDeliverables(service) : null;
  }

  async update(service: DampLabService, changes: ServiceChange): Promise<DampLabService> {
    await this.dampLabServiceModel.updateOne({ _id: service._id }, changes);
    const updated = await this.dampLabServiceModel.findById(service._id);
    return this.normalizeDeliverables(updated!);
  }

  async delete(service: DampLabService): Promise<void> {
    // Remove all allowed connections first
    await this.dampLabServiceModel.updateMany(
      {},
      {
        $pull: { allowedConnections: service._id }
      }
    );

    await this.dampLabServiceModel.deleteOne({ _id: service._id });
  }

  async create(service: CreateService): Promise<DampLabService> {
    // Ensure deliverables defaults to empty array if not provided
    const serviceData = {
      ...service,
      deliverables: service.deliverables || []
    };
    const created = await this.dampLabServiceModel.create(serviceData);
    return this.normalizeDeliverables(created);
  }
}
