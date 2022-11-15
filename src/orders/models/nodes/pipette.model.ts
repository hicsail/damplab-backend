import { Node } from './node.model';
import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'pipette', implements: () => [Node] })
export class Pipette extends Node {
  @Field({ description: 'pipette volume' })
  volume: number;
}
