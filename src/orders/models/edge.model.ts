import { Field, ID, ObjectType } from '@nestjs/graphql';
import { Node } from './node.model';

@ObjectType({ description: 'edge' })
export class Edge {
  @Field(_type => ID, { description: 'edge id' })
  id: string;

  @Field({ description: 'where the edge is originating from' })
  origin: Node;

  @Field({ description: 'where the edge is going to' })
  destination: Node;

  @Field({ description: 'properties associated with the edge' })
  properties: any;
}
