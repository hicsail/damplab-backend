import { Field, InputType } from '@nestjs/graphql';

@InputType()
export class NewOrderInput {
  @Field()
  name: string;

  @Field()
  description: string;
}
