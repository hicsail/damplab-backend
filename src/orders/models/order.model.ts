import { Field, ID, ObjectType } from '@nestjs/graphql';
import { NodeUnion } from './nodes/node-factory';
import { Edge } from './edge.model';


@ObjectType({ description: 'order' })
export class Order {
  @Field((_type) => ID, { description: 'order id' })
  id: string;

  @Field({ description: 'order name' })
  name: string;

  @Field({ description: 'order description' })
  description: string;

  @Field(() => [NodeUnion], { description: 'nodes associated with the order' })
  nodes: typeof NodeUnion[];

  @Field(() => [Edge], { description: 'edges associated with the order' })
  edges: Edge[];
}
