import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Bundle, BundleSchema } from './models/bundle.model';
import { BundleNode, BundleNodeSchema } from './models/node.model';
import { BundleEdge, BundleEdgeSchema } from './models/edge.model';
import { BundlesResolver } from './bundles.resolver';
import { BundlesService } from './bundles.service';
import { BundleNodeService } from './services/node.service';
import { BundleEdgeService } from './services/edge.service';
import { DampLabServicesModule } from '../services/damplab-services.module';
import { BundleEdgeResolver } from './resolvers/edge.resolver';
import { BundlesPipe } from './bundles.pipe';
import { BundleNodeResolver } from './resolvers/node.resolver';
import { AddNodeInputPipe } from './dtos/add-node.input';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Bundle.name, schema: BundleSchema },
      { name: BundleNode.name, schema: BundleNodeSchema },
      { name: BundleEdge.name, schema: BundleEdgeSchema }
    ]),
    DampLabServicesModule
  ],
  providers: [BundlesResolver, BundlesService, BundleNodeService, BundleEdgeService, BundleEdgeResolver, BundlesPipe, BundleNodeResolver, AddNodeInputPipe, AddNodeInputPipe],
  exports: [BundlesPipe, BundlesService]
})
export class BundleModule {}
