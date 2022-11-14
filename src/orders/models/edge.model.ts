import { Field, ID, ObjectType } from '@nestjs/graphql';
import { Node } from './node.model';
import JSON from 'graphql-type-json';


@ObjectType({ description: 'edge' })
export class Edge {
  @Field(_type => ID, { description: 'edge id' })
  id: string;

  @Field({ description: 'where the edge is originating from' })
  origin: Node;

  @Field({ description: 'where the edge is going to' })
  destination: Node;

  @Field(() => JSON, { description: 'properties associated with the edge' })
  properties: any;
}
