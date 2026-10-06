import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DampLabServicesModule } from '../services/damplab-services.module';
import { ParameterSetsModule } from '../parameter-sets/parameter-sets.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SowPresetModule } from '../sow-preset/sow-preset.module';
import { StationModule } from '../station/station.module';
import { ProtocolMapModule } from '../protocol-map/protocol-map.module';
import { Category, CategorySchema } from '../categories/category.model';
import { Bundle, BundleSchema } from '../bundles/bundles.model';
import { CatalogExportService } from './catalog-export.service';
import { CatalogExportResolver } from './catalog-export.resolver';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Category.name, schema: CategorySchema },
      { name: Bundle.name, schema: BundleSchema }
    ]),
    DampLabServicesModule,
    ParameterSetsModule,
    InventoryModule,
    SowPresetModule,
    StationModule,
    ProtocolMapModule
  ],
  providers: [CatalogExportService, CatalogExportResolver]
})
export class CatalogExportModule {}
