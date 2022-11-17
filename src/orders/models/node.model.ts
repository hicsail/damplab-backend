import { Field, ID, InterfaceType, ObjectType, registerEnumType } from '@nestjs/graphql';

/**
 * The different nodes. Each node represents a supported service
 */
export enum DampNodeType {
  PIPETTE,
  MIXER
}
registerEnumType(DampNodeType, { name: 'NodeType' });

/**
 * Shared features that all nodes should have. Also provides a means to
 * resolve the type of node.
 */
@InterfaceType({
  description: 'node',
  resolveType(value: DampNode) {
    switch (value.nodeType) {
      case DampNodeType.PIPETTE: {
        return PipetteNode;
      }
      case DampNodeType.MIXER: {
        return MixerNode;
      }
      default: {
        console.error('Unknown node type');
        console.error(value);
        throw new Error('Unknown node type');
      }
    }
  }
})
export class DampNode {
  @Field(() => ID, { description: 'node id' })
  id: string;

  @Field(() => DampNodeType)
  nodeType: DampNodeType;
}

@ObjectType({ description: 'pipette', implements: () => [DampNode] })
export class PipetteNode extends DampNode {
  @Field({ description: 'pipette volume' })
  volume: number;
}

@ObjectType({ description: 'mixer', implements: () => [DampNode] })
export class MixerNode extends DampNode {
  @Field({ description: 'mixer speed' })
  speed: number;
}
