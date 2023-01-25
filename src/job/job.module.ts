import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkflowModule } from '../workflow/workflow.module';
import { Job, JobSchema } from './job.model';
import { JobResolver } from './job.resolver';
import { JobService } from './job.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: Job.name, schema: JobSchema }]), WorkflowModule],
  providers: [JobService, JobResolver]
})
export class JobModule {}
