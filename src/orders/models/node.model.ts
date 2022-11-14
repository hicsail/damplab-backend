import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'node' })
export class Node {
  @Field(_type => ID, { description: 'node id' })
  id: string;
}
