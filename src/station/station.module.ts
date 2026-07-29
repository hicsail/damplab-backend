import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Station, StationSchema } from './station.model';
import { StationService } from './station.service';
import { StationResolver } from './station.resolver';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: Station.name, schema: StationSchema }]), InventoryModule],
  providers: [StationService, StationResolver],
  exports: [StationService]
})
export class StationModule {}
