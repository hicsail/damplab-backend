import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class AddNodeInput {
  @Field()
  orderId: string;

  @Field()
  nodeId: string;
}
