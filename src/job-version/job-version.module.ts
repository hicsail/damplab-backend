import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JobVersion, JobVersionSchema } from './job-version.model';
import { JobVersionService } from './job-version.service';
import { Job, JobSchema } from '../job/job.model';
import { Workflow, WorkflowSchema } from '../workflow/models/workflow.model';
import { WorkflowNode, WorkflowNodeSchema } from '../workflow/models/node.model';
import { WorkflowEdge, WorkflowEdgeSchema } from '../workflow/models/edge.model';
import { DampLabServicesModule } from '../services/damplab-services.module';
import { JobVersionFieldsResolver } from './job-version-fields.resolver';

/**
 * Versioning owns its own model handles rather than routing through
 * WorkflowService/WorkflowNodeService. Reconciling an edited graph is a single
 * operation that has to interleave node updates, edge replacement and workflow
 * membership; splitting it across three services would scatter it without
 * making any part reusable. The collection-owning services stay in charge of
 * everything else.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: JobVersion.name, schema: JobVersionSchema },
      { name: Job.name, schema: JobSchema },
      { name: Workflow.name, schema: WorkflowSchema },
      { name: WorkflowNode.name, schema: WorkflowNodeSchema },
      { name: WorkflowEdge.name, schema: WorkflowEdgeSchema }
    ]),
    DampLabServicesModule
  ],
  providers: [JobVersionService, JobVersionFieldsResolver],
  exports: [JobVersionService]
})
export class JobVersionModule {}
