import { Node } from './node.model';
import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'mixer' })
export class Mixer extends Node {
  @Field({ description: 'mixer speed' })
  speed: number;
}
