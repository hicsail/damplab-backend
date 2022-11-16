import { Field, ID, InterfaceType, ObjectType, registerEnumType } from '@nestjs/graphql';

/**
 * The different nodes. Each node represents a supported service
 */
export enum NodeType {
  PIPETTE,
  MIXER
}
registerEnumType(NodeType, { name: 'NodeType' });

/**
 * The stored node.
 */
@InterfaceType({
  description: 'node',
  resolveType(value: Node) {
    switch (value.nodeType) {
      case NodeType.PIPETTE: {
        return Pipette;
      }
      case NodeType.MIXER: {
        return Mixer;
      }
      default: {
        console.error('Unknown node type');
        console.error(value);
        throw new Error('Unknown node type');
      }
    }
  }
})
export class Node {
  @Field(() => ID, { description: 'node id' })
  id: string;

  @Field(() => NodeType)
  nodeType: NodeType;
}

@ObjectType({ description: 'pipette', implements: () => [Node] })
export class Pipette extends Node {
  @Field({ description: 'pipette volume' })
  volume: number;
}

@ObjectType({ description: 'mixer', implements: () => [Node] })
export class Mixer extends Node {
  @Field({ description: 'mixer speed' })
  speed: number;
}
