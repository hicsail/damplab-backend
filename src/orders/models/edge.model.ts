import { Field, ID, ObjectType } from '@nestjs/graphql';
import { NodeUnion } from './nodes/node-factory';
import JSON from 'graphql-type-json';

@ObjectType({ description: 'edge' })
export class Edge {
  @Field(() => ID, { description: 'edge id' })
  id: string;

  @Field(() => NodeUnion, { description: 'where the edge is originating from' })
  origin: typeof NodeUnion;

  @Field(() => NodeUnion, { description: 'where the edge is going to' })
  destination: typeof NodeUnion;

  @Field(() => JSON, { description: 'properties associated with the edge' })
  properties: any;
}
