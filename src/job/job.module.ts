import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkflowModule } from '../workflow/workflow.module';
import { CreateJobPipe } from './job.dto';
import { Job, JobSchema } from './job.model';
import { JobResolver } from './job.resolver';
import { JobService } from './job.service';
import { CommentService } from '../comment/comment.service';
import { CommentModule } from '../comment/comment.module';
import { Comment, CommentSchema } from '../comment/comment.model';
import { SOWModule } from '../sow/sow.module';
import { JobAttachmentsService } from './job-attachments.service';
import { JobFeedStatusEntity, JobFeedStatusEntitySchema } from './job-feed-status.model';
import { ActivityModule } from '../activity/activity.module';
import { SecureDnaModule } from '../securedna/securedna.module';
import { AclidModule } from '../aclid/aclid.module';
import { DampLabServicesModule } from '../services/damplab-services.module';
import { JobScreeningService } from './job-screening.service';
import { JobVersionModule } from '../job-version/job-version.module';
import { KeycloakModule } from '../keycloak/keycloak.module';
import { JobReviewService } from './job-review.service';
import { JobReviewOperation, JobReviewOperationSchema } from './job-review-operation.model';
import { ScreeningRun, ScreeningRunSchema } from './screening-run.model';
import { ScreeningRunService } from './screening-run.service';
import { ScreeningRunResolver } from './screening-run.resolver';
import { WorkflowParameterFilesService } from '../workflow/services/workflow-parameter-files.service';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Job.name, schema: JobSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: JobFeedStatusEntity.name, schema: JobFeedStatusEntitySchema },
      { name: JobReviewOperation.name, schema: JobReviewOperationSchema },
      { name: ScreeningRun.name, schema: ScreeningRunSchema }
    ]),
    forwardRef(() => WorkflowModule),
    forwardRef(() => CommentModule),
    forwardRef(() => SOWModule),
    forwardRef(() => ActivityModule),
    SecureDnaModule,
    AclidModule,
    DampLabServicesModule,
    JobVersionModule,
    KeycloakModule,
    forwardRef(() => NotificationModule)
  ],
  providers: [
    JobService,
    JobResolver,
    JobReviewService,
    CreateJobPipe,
    CommentService,
    JobAttachmentsService,
    JobScreeningService,
    ScreeningRunService,
    ScreeningRunResolver,
    // Provided here rather than through WorkflowModule, which would close a cycle (see JobVersionModule). Screening reads uploaded Table files.
    WorkflowParameterFilesService
  ],
  exports: [JobService, JobAttachmentsService]
})
export class JobModule {}
