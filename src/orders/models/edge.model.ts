import { Field, ID, ObjectType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';
import { Node } from './node.model';

@ObjectType({ description: 'edge' })
export class Edge {
  @Field(() => ID, { description: 'edge id' })
  id: string;

  @Field(() => Node, { description: 'where the edge is originating from' })
  origin: Node;

  @Field(() => Node, { description: 'where the edge is going to' })
  destination: Node;

  @Field(() => JSON, { description: 'properties associated with the edge' })
  properties: any;
}
