import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkflowModule } from '../workflow/workflow.module';
import { CreateJobPipe } from './job.dto';
import { Job, JobSchema } from './job.model';
import { JobResolver } from './job.resolver';
import { JobService } from './job.service';
import { CommentService } from '../comment/comment.service';
import { CommentModule } from '../comment/comment.module';
import { Comment, CommentSchema } from '../comment/comment.model';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Job.name, schema: JobSchema },
      { name: Comment.name, schema: CommentSchema }
    ]),
    WorkflowModule,
    CommentModule
  ],
  providers: [JobService, JobResolver, CreateJobPipe, CommentService]
})
export class JobModule {}