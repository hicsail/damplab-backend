import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { DampLabService, DampLabServiceDocument, ServicePricingMode } from './models/damplab-service.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { ServiceChange } from './dtos/update.dto';
import { CreateService } from './dtos/create.dto';
import { Pricing } from '../pricing/pricing.model';
import { InventoryService } from '../inventory/inventory.service';
import { equipmentUsePricingModeViolation, equipmentUseRuleViolation } from './equipment-use.validation';
import { ParameterSet, ParameterSetDocument } from '../parameter-sets/parameter-set.model';
import { clashMessage, effectiveParameters, findParameterSetClashes, ParameterSetLike, setsByIdMap, stripSetDerivedParameters } from './effective-parameters';

@Injectable()
export class DampLabServices {
  constructor(
    @InjectModel(DampLabService.name) private readonly dampLabServiceModel: Model<DampLabServiceDocument>,
    private readonly inventoryService: InventoryService,
    @Optional() @InjectModel(ParameterSet.name) private readonly parameterSetModel?: Model<ParameterSetDocument>
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

  /**
   * Backward compatibility: hydrate `pricing` from legacy scalar fields when present.
   */
  /**
   * Synthesizes `pricing` from the deprecated flat fields when a service has no
   * pricing object yet.
   *
   * All five tiers, not three. It used to carry only internal/external/legacy,
   * so a service priced per-tier in the flat fields came back claiming to have
   * pricing while `externalAcademic`, `externalMarket` and `externalNoSalary`
   * were quietly absent — and every reader of the synthesized object (the
   * client-facing catalog quote among them) fell through to `legacy` for those
   * three categories.
   */
  private normalizePricing(service: DampLabService): DampLabService {
    const hasPricingObject = service.pricing && typeof service.pricing === 'object';
    if (hasPricingObject) return service;

    const row = service as any;
    const internal = row.internalPrice;
    const external = row.externalPrice;
    const externalAcademic = row.externalAcademicPrice;
    const externalMarket = row.externalMarketPrice;
    const externalNoSalary = row.externalNoSalaryPrice;
    const legacy = row.price;

    if (internal != null || external != null || externalAcademic != null || externalMarket != null || externalNoSalary != null || legacy != null) {
      const pricing: Pricing = {
        internal: internal ?? undefined,
        external: external ?? undefined,
        externalAcademic: externalAcademic ?? undefined,
        externalMarket: externalMarket ?? undefined,
        externalNoSalary: externalNoSalary ?? undefined,
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
    this.normalizeProtocolIds(service);
    return service;
  }

  /**
   * Guarantees `protocolIds` is always an array, folding in the deprecated
   * single `protocolId` for documents written before the field existed. Means
   * clients never have to handle both shapes, and a backfill is an optimization
   * rather than a correctness requirement.
   */
  private normalizeProtocolIds(service: DampLabService): void {
    if (!Array.isArray(service.protocolIds) || service.protocolIds.length === 0) {
      const legacy = typeof service.protocolId === 'string' ? service.protocolId.trim() : '';
      service.protocolIds = legacy ? [legacy] : [];
      return;
    }
    // Drop blanks/dupes while preserving admin-specified order.
    service.protocolIds = service.protocolIds.map((p) => (typeof p === 'string' ? p.trim() : '')).filter((p, i, arr) => p && arr.indexOf(p) === i);
  }

  /** One query for every set the given ids reference; none when there are no ids. */
  private async loadSetsById(ids: ReadonlyArray<unknown>): Promise<Map<string, ParameterSetLike>> {
    const unique = [...new Set(ids.map((id) => String(id)))].filter((id) => mongoose.isValidObjectId(id));
    if (unique.length === 0 || !this.parameterSetModel) return new Map();
    const sets = await this.parameterSetModel.find({ _id: { $in: unique } }).exec();
    return setsByIdMap(sets as unknown as ParameterSetLike[]);
  }

  /**
   * `parameters` becomes the effective list and `ownParameters` the stored one.
   * Safe on hydrated documents: nothing saves a loaded service (`update` goes
   * through `updateOne`, which strips set-derived entries).
   */
  private async withEffectiveParameters<T extends DampLabService>(services: T[]): Promise<T[]> {
    const setsById = await this.loadSetsById(services.flatMap((s) => (Array.isArray(s.parameterSetIds) ? s.parameterSetIds : [])));
    for (const service of services) {
      const own = Array.isArray(service.parameters) ? service.parameters : [];
      if (!Array.isArray(service.parameterSetIds)) service.parameterSetIds = [];
      service.hiddenFromClients = service.hiddenFromClients === true;
      service.ownParameters = own;
      service.parameters = effectiveParameters({ parameters: own, parameterSetIds: service.parameterSetIds }, setsById);
    }
    return services;
  }

  /** Every id must resolve, and no two of the sets may share a parameter id. */
  private async assertParameterSetsCompatible(ids: ReadonlyArray<unknown>): Promise<void> {
    const wanted = ids.map((id) => String(id));
    const byId = await this.loadSetsById(wanted);
    const missing = wanted.find((id) => !byId.has(id));
    if (missing) throw new BadRequestException(`Parameter set ${missing} does not exist`);
    const clashes = findParameterSetClashes(wanted.map((id) => byId.get(id)!));
    if (clashes.length > 0) throw new BadRequestException(clashMessage(clashes[0]));
  }

  /** Active services only (for admin catalog, canvas palette, bundles, categories, allowedConnections). */
  async findAll(): Promise<DampLabService[]> {
    const services = await this.dampLabServiceModel.find({ isDeleted: { $ne: true } }).exec();
    return this.withEffectiveParameters(services.map((service) => this.normalizeService(service)));
  }

  /**
   * Find a list of active services by their IDs (preserves caller order; omits missing and soft-deleted).
   */
  async findByIds(ids: mongoose.Types.ObjectId[]): Promise<DampLabService[]> {
    const services = await this.dampLabServiceModel.find({ _id: { $in: ids }, isDeleted: { $ne: true } }).exec();
    const normalized = await this.withEffectiveParameters(services.map((service) => this.normalizeService(service)));
    const serviceById = new Map(normalized.map((service) => [String(service._id), service] as const));
    return ids.map((id) => serviceById.get(String(id))).filter((service): service is DampLabService => Boolean(service));
  }

  /**
   * By database id, including soft-deleted (for workflow nodes and mutation targets).
   */
  async findOne(id: string): Promise<DampLabService | null> {
    const service = await this.dampLabServiceModel.findById(id).exec();
    return service ? (await this.withEffectiveParameters([this.normalizeService(service)]))[0] : null;
  }

  /** Active service only; null if missing or soft-deleted. */
  async findOneActive(id: string): Promise<DampLabService | null> {
    const service = await this.dampLabServiceModel.findOne({ _id: id, isDeleted: { $ne: true } }).exec();
    return service ? (await this.withEffectiveParameters([this.normalizeService(service)]))[0] : null;
  }

  /** The operation's sets, in its order; ids that no longer resolve are dropped. */
  async findParameterSetsFor(service: DampLabService): Promise<ParameterSet[]> {
    const ids = (service.parameterSetIds ?? []).map((id) => String(id));
    const byId = await this.loadSetsById(ids);
    return ids.map((id) => byId.get(id)).filter((set): set is ParameterSetLike => Boolean(set)) as unknown as ParameterSet[];
  }

  /** Non-deleted operations referencing the set. */
  async findUsingParameterSet(setId: string): Promise<DampLabService[]> {
    if (!mongoose.isValidObjectId(setId)) return [];
    const services = await this.dampLabServiceModel.find({ parameterSetIds: setId, isDeleted: { $ne: true } }).exec();
    return this.withEffectiveParameters(services.map((service) => this.normalizeService(service)));
  }

  /** Ids of soft-deleted operations, for the spreadsheet upload's "deleted" warning. */
  async findDeletedIds(): Promise<string[]> {
    const services = await this.dampLabServiceModel.find({ isDeleted: true }, { _id: 1 }).exec();
    return services.map((service) => String(service._id));
  }

  /**
   * The server-side twin of the catalog editor's inline warning: an operation that
   * books equipment has to require a piece of equipment somebody can book.
   *
   * `equipmentUse` and `inventoryRequirements` are read as the *merged* record, so a
   * partial update that strips the last bookable item off an already-flagged service
   * is refused as firmly as one that turns the flag on without one. When neither
   * field is in play both values come from the stored record, which was valid when
   * it was written, and no inventory lookup happens at all.
   */
  private async assertEquipmentUseIsSatisfiable(equipmentUse: boolean | undefined, requirementIds: ReadonlyArray<unknown> | undefined, pricingMode?: unknown): Promise<void> {
    if (equipmentUse !== true) return;
    const modeViolation = equipmentUsePricingModeViolation(equipmentUse, pricingMode);
    if (modeViolation) throw new BadRequestException(modeViolation);
    const ids = (requirementIds ?? []).map((v) => String(v));
    const items = ids.length ? await this.inventoryService.findByIds(ids) : [];
    const violation = equipmentUseRuleViolation(equipmentUse, requirementIds, items as any);
    if (violation) throw new BadRequestException(violation);
  }

  async update(service: DampLabService, changes: ServiceChange): Promise<DampLabService> {
    if (service.isDeleted === true) {
      throw new BadRequestException(`Cannot update soft-deleted service ${service._id}`);
    }
    const write: Record<string, unknown> = { ...(changes as any) };
    if (Object.prototype.hasOwnProperty.call(write, 'parameters')) write.parameters = stripSetDerivedParameters(write.parameters);
    if (Array.isArray(write.parameterSetIds)) await this.assertParameterSetsCompatible(write.parameterSetIds);
    const mergedEquipmentUse = (changes as any).equipmentUse ?? (service as any).equipmentUse;
    const mergedRequirements = (changes as any).inventoryRequirements ?? (service as any).inventoryRequirements;
    const mergedPricingMode = (changes as any).pricingMode ?? (service as any).pricingMode;
    await this.assertEquipmentUseIsSatisfiable(mergedEquipmentUse, mergedRequirements, mergedPricingMode);
    await this.dampLabServiceModel.updateOne({ _id: service._id }, write);
    const updated = await this.dampLabServiceModel.findById(service._id);
    return (await this.withEffectiveParameters([this.normalizeService(updated!)]))[0];
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
    await this.assertEquipmentUseIsSatisfiable((service as any).equipmentUse, (service as any).inventoryRequirements, (service as any).pricingMode);
    if (Array.isArray((service as any).parameterSetIds) && (service as any).parameterSetIds.length > 0) {
      await this.assertParameterSetsCompatible((service as any).parameterSetIds);
    }
    // Ensure deliverables defaults to empty array if not provided
    const serviceData = {
      ...service,
      parameters: stripSetDerivedParameters((service as any).parameters ?? []),
      deliverables: service.deliverables || []
    };
    const created = await this.dampLabServiceModel.create(serviceData);
    return (await this.withEffectiveParameters([this.normalizeService(created)]))[0];
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
      deliverables: [],
      protocolIds: [],
      ownParameters: [],
      parameterSetIds: [] as mongoose.Types.ObjectId[],
      hiddenFromClients: false
    } as DampLabService;
    return this.normalizeService(stub);
  }
}
