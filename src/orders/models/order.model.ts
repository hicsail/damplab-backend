import { Field, ID, ObjectType } from '@nestjs/graphql';
import { Edge } from './edge.model';
import { DampNode } from './node.model';


@ObjectType({ description: 'order' })
export class Order {
  @Field((_type) => ID, { description: 'order id' })
  id: string;

  @Field({ description: 'order name' })
  name: string;

  @Field({ description: 'order description' })
  description: string;

  @Field(() => [DampNode], { description: 'nodes associated with the order' })
  nodes: DampNode[];

  @Field(() => [Edge], { description: 'edges associated with the order' })
  edges: Edge[];
}
