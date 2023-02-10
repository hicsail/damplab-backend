import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Workflow, WorkflowSchema } from './models/workflow.model';
import { WorkflowNode, WorkflowNodeSchema } from './models/node.model';
import { WorkflowEdge, WorkflowEdgeSchema } from './models/edge.model';
import { WorkflowResolver } from './workflow.resolver';
import { WorkflowService } from './workflow.service';
import { WorkflowNodeService } from './services/node.service';
import { WorkflowEdgeService } from './services/edge.service';
import { DampLabServicesModule } from '../services/damplab-services.module';
import { WorkflowEdgeResolver } from './resolvers/edge.resolver';
import { WorkflowPipe } from './workflow.pipe';
import { WorkflowNodeResolver } from './resolvers/node.resolver';
import { AddWorkflowInputPipe } from './dtos/add-workflow.input';
import { AddNodeInputPipe } from './dtos/add-node.input';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Workflow.name, schema: WorkflowSchema },
      { name: WorkflowNode.name, schema: WorkflowNodeSchema },
      { name: WorkflowEdge.name, schema: WorkflowEdgeSchema }
    ]),
    DampLabServicesModule
  ],
  providers: [WorkflowResolver, WorkflowService, WorkflowNodeService, WorkflowEdgeService, WorkflowEdgeResolver, WorkflowPipe, WorkflowNodeResolver, AddWorkflowInputPipe, AddNodeInputPipe],
  exports: [WorkflowPipe, WorkflowService, AddWorkflowInputPipe]
})
export class WorkflowModule {}
