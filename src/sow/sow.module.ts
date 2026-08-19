import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SOW, SOWSchema } from './sow.model';
import { SowVersion, SowVersionSchema } from './sow-version.model';
import { SOWService } from './sow.service';
import { SowVersionService } from './sow-version.service';
import { SOWResolver } from './sow.resolver';
import { SowVersionFieldsResolver } from './sow-version-fields.resolver';
import { JobModule } from '../job/job.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { DampLabServicesModule } from '../services/damplab-services.module';
import { SowPresetModule } from '../sow-preset/sow-preset.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SOW.name, schema: SOWSchema },
      { name: SowVersion.name, schema: SowVersionSchema }
    ]),
    forwardRef(() => JobModule),
    forwardRef(() => WorkflowModule),
    DampLabServicesModule,
    SowPresetModule
  ],
  providers: [SOWService, SowVersionService, SOWResolver, SowVersionFieldsResolver],
  exports: [SOWService, SowVersionService]
})
export class SOWModule {}
