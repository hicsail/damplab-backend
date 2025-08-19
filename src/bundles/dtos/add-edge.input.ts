import { Field, ID, InputType, OmitType } from '@nestjs/graphql';
import { BundleEdge } from '../models/edge.model';


@InputType()
export class AddEdgeInput extends OmitType(BundleEdge, ['_id', 'source', 'target'] as const, InputType) {
  @Field(() => ID, { description: 'ID of source node' })
  source: string;

  @Field(() => ID, { description: 'ID of target node' })
  target: string;
}