import { Field, InputType, OmitType } from '@nestjs/graphql';
import { Node } from '../models/node.model';

@InputType()
class NewNodeInput extends OmitType(Node, ['id'] as const, InputType) {}

@InputType()
export class AddNodeInput {
  @Field()
  orderId: string;

  @Field(() => NewNodeInput)
  node: NewNodeInput;
}
