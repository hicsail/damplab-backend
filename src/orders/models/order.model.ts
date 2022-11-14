import { createUnionType, Field, ID, ObjectType } from '@nestjs/graphql';
import { Node, NodeType } from './nodes/node.model';
import { Edge } from './edge.model';
import {Pipette} from './nodes/pipette.model';
import {Mixer} from './nodes/mixer.model';

// TODO: Move this inside of the factory file once a factor is made for the
//       nodes
const NodeUnion = createUnionType({
  name: 'NodeUnion',
  types: () => [Pipette, Mixer] as const,
  resolveType(value: Node) {
    if (value.nodeType === NodeType.MIXER) {
      return Mixer;
    }
    if (value.nodeType === NodeType.PIPETTE) {
      return Pipette;
    }
    return undefined;
  }
});

@ObjectType({ description: 'order' })
export class Order {
  @Field((_type) => ID, { description: 'order id' })
  id: string;

  @Field({ description: 'order name' })
  name: string;

  @Field({ description: 'order description' })
  description: string;

  @Field(() => [NodeUnion], { description: 'nodes associated with the order' })
  nodes: typeof NodeUnion[];

  @Field(() => [Edge], { description: 'edges associated with the order' })
  edges: Edge[];
}
