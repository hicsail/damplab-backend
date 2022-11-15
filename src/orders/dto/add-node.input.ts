import { Field, InputType } from '@nestjs/graphql';
import { Node } from '../models/node.model';

@InputType()
class NewNodeInput extends Node {
  @Field()
  id: string;

}

@InputType()
export class AddNodeInput {
  @Field()
  orderId: string;

  @Field(() => NewNodeInput)
  node: NewNodeInput;
}
