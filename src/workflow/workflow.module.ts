import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Workflow, WorkflowSchema } from './models/workflow.model';
import { WorkflowNode, WorkflowNodeSchema } from './models/node.model';
import { WorkflowEdge, WorkflowEdgeSchema } from './models/edge.model';
import { WorkflowResolver } from './workflow.resolver';
import { WorkflowService } from './workflow.service';
import { DampLabServicesModule } from '../services/damplab-services.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Workflow.name, schema: WorkflowSchema },
      { name: WorkflowNode.name, schema: WorkflowNodeSchema },
      { name: WorkflowEdge.name, schema: WorkflowEdgeSchema },
    ]),
    DampLabServicesModule,
  ],
  providers: [WorkflowResolver, WorkflowService],
})
export class WorkflowModule {}
