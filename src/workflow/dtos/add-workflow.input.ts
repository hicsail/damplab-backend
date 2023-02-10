import { Field, InputType, OmitType } from '@nestjs/graphql';
import { AddNodeInput, AddNodeInputFull, AddNodeInputPipe } from './add-node.input';
import { AddEdgeInput } from './add-edge.input';
import { Workflow } from '../models/workflow.model';
import { Injectable, PipeTransform } from '@nestjs/common';

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

export interface AddWorkflowInputFull extends Omit<Workflow, '_id' | 'nodes' | 'edges' | 'state'> {
  nodes: AddNodeInputFull[];
  edges: AddEdgeInput[];
}

/** Verifies the services are valid */
@Injectable()
export class AddWorkflowInputPipe implements PipeTransform<AddWorkflowInput, Promise<AddWorkflowInputFull>> {
  constructor(private nodePipe: AddNodeInputPipe) {}

  async transform(value: AddWorkflowInput): Promise<AddWorkflowInputFull> {
    const nodes = await Promise.all(value.nodes.map((node) => this.nodePipe.transform(node)));
    return { ...value, nodes };
  }
}
