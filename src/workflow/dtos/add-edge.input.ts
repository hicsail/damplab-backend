import { Field, ID, InputType, OmitType } from '@nestjs/graphql';
import { WorkflowEdge } from '../models/edge.model';

@InputType()
export class AddEdgeInput extends OmitType(WorkflowEdge, ['_id', 'source', 'destination'] as const, InputType) {
  @Field(() => ID, { description: 'The ID of the source node, this is the workflow ID' })
  source: string;

  @Field(() => ID, { description: 'The ID of the destination node, this is the workflow ID' })
  destination: string;
}
