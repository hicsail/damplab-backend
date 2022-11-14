import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'node' })
export class Node {
  @Field(() => ID, { description: 'node id' })
  id: string;
}
