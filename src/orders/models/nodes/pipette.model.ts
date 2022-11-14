import { Node } from './node.model';
import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'pipette' })
export class Pipette extends Node {
  @Field({ description: 'pipette volume' })
  volume: number;
}
