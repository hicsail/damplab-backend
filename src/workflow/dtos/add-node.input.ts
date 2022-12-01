import { InputType, OmitType } from '@nestjs/graphql';
import { WorkflowNode } from '../models/node.model';

@InputType()
export class AddNodeInput extends OmitType(WorkflowNode, ['_id'] as const, InputType) {}
