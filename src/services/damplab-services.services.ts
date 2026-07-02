import { BadRequestException, Injectable } from '@nestjs/common';
import { DampLabService, DampLabServiceDocument, ServicePricingMode } from './models/damplab-service.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { ServiceChange } from './dtos/update.dto';
import { CreateService } from './dtos/create.dto';
import { Pricing } from '../pricing/pricing.model';

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

  /**
   * Backward compatibility: hydrate `pricing` from legacy scalar fields when present.
   */
  private normalizePricing(service: DampLabService): DampLabService {
    const hasPricingObject = service.pricing && typeof service.pricing === 'object';
    if (hasPricingObject) return service;

    const internal = (service as any).internalPrice;
    const external = (service as any).externalPrice;
    const legacy = (service as any).price;

    if (internal != null || external != null || legacy != null) {
      const pricing: Pricing = {
        internal: internal ?? undefined,
        external: external ?? undefined,
        legacy: legacy ?? undefined
      };
      service.pricing = pricing;
    }
    return service;
  }

  private normalizeService(service: DampLabService): DampLabService {
    this.normalizeDeliverables(service);
    this.normalizeParameters(service);
    this.normalizePricingMode(service);
    this.normalizePricing(service);
    return service;
  }

  /** Active services only (for admin catalog, canvas palette, bundles, categories, allowedConnections). */
  async findAll(): Promise<DampLabService[]> {
    const services = await this.dampLabServiceModel.find({ isDeleted: { $ne: true } }).exec();
    return services.map((service) => this.normalizeService(service));
  }

  /**
   * Find a list of active services by their IDs (preserves caller order; omits missing and soft-deleted).
   */
  async findByIds(ids: mongoose.Types.ObjectId[]): Promise<DampLabService[]> {
    const services = await this.dampLabServiceModel.find({ _id: { $in: ids }, isDeleted: { $ne: true } }).exec();
    const serviceById = new Map(services.map((service) => [String(service._id), this.normalizeService(service)] as const));
    return ids.map((id) => serviceById.get(String(id))).filter((service): service is DampLabService => Boolean(service));
  }

  /**
   * By database id, including soft-deleted (for workflow nodes and mutation targets).
   */
  async findOne(id: string): Promise<DampLabService | null> {
    const service = await this.dampLabServiceModel.findById(id).exec();
    return service ? this.normalizeService(service) : null;
  }

  /** Active service only; null if missing or soft-deleted. */
  async findOneActive(id: string): Promise<DampLabService | null> {
    const service = await this.dampLabServiceModel.findOne({ _id: id, isDeleted: { $ne: true } }).exec();
    return service ? this.normalizeService(service) : null;
  }

  async update(service: DampLabService, changes: ServiceChange): Promise<DampLabService> {
    if (service.isDeleted === true) {
      throw new BadRequestException(`Cannot update soft-deleted service ${service._id}`);
    }
    await this.dampLabServiceModel.updateOne({ _id: service._id }, changes);
    const updated = await this.dampLabServiceModel.findById(service._id);
    return this.normalizeService(updated!);
  }

  async delete(service: DampLabService): Promise<void> {
    if (service.isDeleted === true) {
      return;
    }
    await this.dampLabServiceModel.updateMany(
      {},
      {
        $pull: { allowedConnections: service._id }
      }
    );

    await this.dampLabServiceModel.updateOne({ _id: service._id }, { $set: { isDeleted: true } });
  }

  async create(service: CreateService): Promise<DampLabService> {
    // Ensure deliverables defaults to empty array if not provided
    const serviceData = {
      ...service,
      deliverables: service.deliverables || []
    };
    const created = await this.dampLabServiceModel.create(serviceData);
    return this.normalizeService(created);
  }

  /**
   * Stand-in when a workflow node still references a service id that no longer exists in the DB
   * (e.g. legacy hard deletes). Keeps GraphQL and lab monitor from failing on missing documents.
   */
  placeholderForMissingService(id: string): DampLabService {
    const stub = {
      _id: id,
      name: 'Unknown service (removed)',
      icon: '',
      parameters: [],
      paramGroups: [] as any[],
      allowedConnections: [] as mongoose.Types.ObjectId[],
      description: 'This service is no longer in the catalog; the node still references its former id.',
      deliverables: []
    } as DampLabService;
    return this.normalizeService(stub);
  }
}
