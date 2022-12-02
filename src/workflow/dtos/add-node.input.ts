import { ID, Field, InputType, OmitType } from '@nestjs/graphql';
import { WorkflowNode } from '../models/node.model';

@InputType()
export class AddNodeInput extends OmitType(WorkflowNode, ['_id', 'service'] as const, InputType) {
  @Field(() => ID, { description: 'The ID of the service this node is a part of' })
  serviceID: string;
}
