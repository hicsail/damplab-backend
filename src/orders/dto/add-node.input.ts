import { Field, InputType } from '@nestjs/graphql';
import { NodeType } from '../models/nodes/node.model';

@InputType()
export class AddNodeInput {
  @Field()
  orderId: string;

  @Field()
  nodeId: string;

  @Field(() => NodeType)
  nodeType: NodeType;
}
