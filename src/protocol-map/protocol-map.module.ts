import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProtocolStepMapping, ProtocolStepMappingSchema } from './protocol-step-mapping.model';
import { ProtocolMapService } from './protocol-map.service';
import { ProtocolMapResolver } from './protocol-map.resolver';
import { ProtocolsModule } from '../protocols/protocols.module';
import { DampLabServicesModule } from '../services/damplab-services.module';
import { InventoryModule } from '../inventory/inventory.module';
import { StationModule } from '../station/station.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ProtocolStepMapping.name, schema: ProtocolStepMappingSchema }]),
    ProtocolsModule,
    DampLabServicesModule,
    InventoryModule,
    StationModule
  ],
  providers: [ProtocolMapService, ProtocolMapResolver],
  exports: [ProtocolMapService]
})
export class ProtocolMapModule {}
