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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Job.name, schema: JobSchema },
      { name: Comment.name, schema: CommentSchema }
    ]),
    WorkflowModule,
    forwardRef(() => CommentModule),
    forwardRef(() => SOWModule)
  ],
  providers: [JobService, JobResolver, CreateJobPipe, CommentService],
  exports: [JobService]
})
export class JobModule {}
