import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SOW, SOWSchema } from './sow.model';
import { SOWService } from './sow.service';
import { SOWResolver } from './sow.resolver';
import { JobModule } from '../job/job.module';
import { DampLabServicesModule } from '../services/damplab-services.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SOW.name, schema: SOWSchema }]),
    forwardRef(() => JobModule),
    DampLabServicesModule
  ],
  providers: [SOWService, SOWResolver],
  exports: [SOWService]
})
export class SOWModule {}
