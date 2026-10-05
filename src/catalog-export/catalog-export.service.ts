import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DampLabServices } from '../services/damplab-services.services';
import { ParameterSetsService } from '../parameter-sets/parameter-sets.service';
import { InventoryService } from '../inventory/inventory.service';
import { SowTextPresetService } from '../sow-preset/sow-text-preset.service';
import { StationService } from '../station/station.service';
import { ProtocolMapService } from '../protocol-map/protocol-map.service';
import { Category, CategoryDocument } from '../categories/category.model';
import { Bundle, BundleDocument } from '../bundles/bundles.model';
import { buildCatalogExport, CatalogExport } from './catalog-export.builder';

@Injectable()
export class CatalogExportService {
  constructor(
    private readonly services: DampLabServices,
    private readonly parameterSets: ParameterSetsService,
    private readonly inventory: InventoryService,
    private readonly sowPresets: SowTextPresetService,
    private readonly stations: StationService,
    private readonly protocolMaps: ProtocolMapService,
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(Bundle.name) private readonly bundleModel: Model<BundleDocument>
  ) {}

  async export(): Promise<CatalogExport> {
    const [services, parameterSets, inventory, sowPresets, categories, bundles, stations, protocolMaps] = await Promise.all([
      this.services.findAll(),
      this.parameterSets.findAll(),
      this.inventory.findAllActive(),
      this.sowPresets.listAll(),
      this.categoryModel.find().exec(),
      this.bundleModel.find().exec(),
      this.stations.findAll(),
      this.protocolMaps.findAll()
    ]);
    return buildCatalogExport({ services, parameterSets, inventory, sowPresets, categories, bundles, stations, protocolMaps, now: new Date() });
  }
}
