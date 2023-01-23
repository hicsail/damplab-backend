import { Field, InputType, OmitType } from '@nestjs/graphql';
import { AddNodeInput } from './add-node.input';
import { AddEdgeInput } from './add-edge.input';
import { Workflow } from '../models/workflow.model';

/**
 * Input for making a new workflow. Removes the ID field from the workflow
 * and the nodes+edges are provided via the addNode and addEdge inputs.
 */
@InputType()
export class AddWorkflowInput extends OmitType(Workflow, ['_id', 'nodes', 'edges', 'state'] as const, InputType) {
  @Field(() => [AddNodeInput], { description: 'The nodes in the workflow' })
  nodes: AddNodeInput[];

  @Field(() => [AddEdgeInput], { description: 'The edges in the workflow' })
  edges: AddEdgeInput[];
}
