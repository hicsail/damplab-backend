import { Node, NodeType } from './node.model';
import { createUnionType } from '@nestjs/graphql';
import { Pipette } from './pipette.model';
import { Mixer } from './mixer.model';

export const NodeUnion = createUnionType({
  name: 'NodeUnion',
  types: () => [Pipette, Mixer] as const,
  resolveType(value: Node) {
    switch (value.nodeType) {
      case NodeType.PIPETTE:
        return Pipette;
      case NodeType.MIXER:
        return Mixer;
      default:
        return null;
    }
  }
});
