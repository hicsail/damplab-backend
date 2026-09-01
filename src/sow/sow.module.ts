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
import { JobVersionModule } from '../job-version/job-version.module';
import { ActivityModule } from '../activity/activity.module';
import { CommentModule } from '../comment/comment.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SOW.name, schema: SOWSchema },
      { name: SowVersion.name, schema: SowVersionSchema }
    ]),
    forwardRef(() => JobModule),
    forwardRef(() => WorkflowModule),
    DampLabServicesModule,
    SowPresetModule,
    JobVersionModule,
    ActivityModule,
    forwardRef(() => NotificationModule),
    // For the automated comments a withdrawal or a voided signature posts: the
    // customer's job thread is the only channel they actually read.
    forwardRef(() => CommentModule)
  ],
  providers: [SOWService, SowVersionService, SOWResolver, SowVersionFieldsResolver],
  exports: [SOWService, SowVersionService]
})
export class SOWModule {}
