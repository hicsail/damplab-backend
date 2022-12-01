import { InputType, OmitType } from '@nestjs/graphql';
import { WorkflowEdge } from '../models/edge.model';

@InputType()
export class AddEdgeInput extends OmitType(WorkflowEdge, ['_id'] as const, InputType) {}
