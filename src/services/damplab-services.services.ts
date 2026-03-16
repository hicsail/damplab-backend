import { Injectable } from '@nestjs/common';
import { DampLabService, DampLabServiceDocument, ServicePricingMode } from './models/damplab-service.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { ServiceChange } from './dtos/update.dto';
import { CreateService } from './dtos/create.dto';
import { ProtocolsIoService } from '../protocols-io/protocols-io.service';

@Injectable()
export class DampLabServices {
  constructor(
    @InjectModel(DampLabService.name) private readonly dampLabServiceModel: Model<DampLabServiceDocument>,
    private readonly protocolsIoService: ProtocolsIoService
  ) {}

  /**
   * Ensure deliverables field is always an array (for backward compatibility)
   */
  private normalizeDeliverables(service: DampLabService): DampLabService {
    if (!service.deliverables) {
      service.deliverables = [];
    }
    return service;
  }

  /**
   * Ensure each parameter has allowMultipleValues (default false) so APIs return it consistently.
   */
  private normalizeParameters(service: DampLabService): DampLabService {
    if (Array.isArray(service.parameters)) {
      for (const param of service.parameters) {
        if (param && typeof param === 'object' && !Object.prototype.hasOwnProperty.call(param, 'allowMultipleValues')) {
          param.allowMultipleValues = false;
        } else if (param && typeof param === 'object') {
          param.allowMultipleValues = param.allowMultipleValues === true;
        }
      }
    }
    return service;
  }

  /**
   * Ensure pricingMode defaults to SERVICE for consistency.
   */
  private normalizePricingMode(service: DampLabService): DampLabService {
    if (!service.pricingMode) {
      service.pricingMode = ServicePricingMode.SERVICE;
    }
    return service;
  }

  private normalizeService(service: DampLabService): DampLabService {
    this.normalizeDeliverables(service);
    this.normalizeParameters(service);
    this.normalizePricingMode(service);
    return service;
  }

  async findAll(): Promise<DampLabService[]> {
    const services = await this.dampLabServiceModel.find().exec();
    return services.map((service) => this.normalizeService(service));
  }

  /**
   * Find a list of services by their IDs.
   */
  async findByIds(ids: mongoose.Types.ObjectId[]): Promise<DampLabService[]> {
    const services = await this.dampLabServiceModel.find({ _id: { $in: ids } }).exec();
    return services.map((service) => this.normalizeService(service));
  }

  async findOne(id: string): Promise<DampLabService | null> {
    const service = await this.dampLabServiceModel.findById(id).exec();
    return service ? this.normalizeService(service) : null;
  }

  private async applyProtocolsIoMetadata(
    existing: DampLabService | null,
    partial: any
  ): Promise<any> {
    const incomingId = partial.protocolsIoId ?? existing?.protocolsIoId;
    if (!incomingId || !this.protocolsIoService.isConfigured()) {
      return partial;
    }
    try {
      const meta = await this.protocolsIoService.getProtocolById(incomingId);
      if (meta) {
        partial.protocolsIoId = meta.id;
        partial.protocolsIoUrl = meta.url || partial.protocolsIoUrl;
        partial.protocolsIoMetadata = {
          id: meta.id,
          title: meta.title,
          url: meta.url,
          version: meta.version,
          description: meta.description
        };
      }
    } catch {
      // Swallow protocols.io errors so service updates still succeed.
    }
    return partial;
  }

  async update(service: DampLabService, changes: ServiceChange): Promise<DampLabService> {
    const existing = await this.dampLabServiceModel.findById(service._id).exec();
    const withMeta = await this.applyProtocolsIoMetadata(existing, changes);
    await this.dampLabServiceModel.updateOne({ _id: service._id }, withMeta);
    const updated = await this.dampLabServiceModel.findById(service._id);
    return this.normalizeService(updated!);
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
    let serviceData: any = {
      ...service,
      deliverables: service.deliverables || []
    };
    serviceData = await this.applyProtocolsIoMetadata(null, serviceData);
    const created = await this.dampLabServiceModel.create(serviceData);
    return this.normalizeService(created);
  }
}
