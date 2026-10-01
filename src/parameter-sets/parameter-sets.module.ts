import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ParameterSet, ParameterSetSchema } from './parameter-set.model';
import { ParameterSetsService } from './parameter-sets.service';
import { ParameterSetsResolver } from './parameter-sets.resolver';
import { DampLabServicesModule } from '../services/damplab-services.module';

@Module({
  imports: [MongooseModule.forFeature([{ name: ParameterSet.name, schema: ParameterSetSchema }]), DampLabServicesModule],
  providers: [ParameterSetsService, ParameterSetsResolver],
  exports: [ParameterSetsService]
})
export class ParameterSetsModule {}
