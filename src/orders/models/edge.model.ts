import { Field, ID, ObjectType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';
import { DampNode } from './node.model';

@ObjectType({ description: 'edge' })
export class Edge {
  @Field(() => ID, { description: 'edge id' })
  id: string;

  @Field(() => DampNode, { description: 'where the edge is originating from' })
  origin: DampNode;

  @Field(() => DampNode, { description: 'where the edge is going to' })
  destination: DampNode;

  @Field(() => JSON, { description: 'properties associated with the edge' })
  properties: any;
}
