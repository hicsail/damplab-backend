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
import { ScreeningBatchSchema } from '../mpi/models/screening-batch.schema';
import { MPIModule } from '../mpi/mpi.module';
import { DampLabServicesModule } from '../services/damplab-services.module';
import { JobScreeningService } from './job-screening.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Job.name, schema: JobSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: JobFeedStatusEntity.name, schema: JobFeedStatusEntitySchema },
      { name: 'ScreeningBatch', schema: ScreeningBatchSchema }
    ]),
    forwardRef(() => WorkflowModule),
    forwardRef(() => CommentModule),
    forwardRef(() => SOWModule),
    ActivityModule,
    MPIModule,
    DampLabServicesModule
  ],
  providers: [JobService, JobResolver, CreateJobPipe, CommentService, JobAttachmentsService, JobScreeningService],
  exports: [JobService]
})
export class JobModule {}
