import { Field, ID, InterfaceType, registerEnumType } from '@nestjs/graphql';

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
@InterfaceType({ description: 'node' })
export class Node {
  @Field(() => ID, { description: 'node id' })
  id: string;

  @Field(() => NodeType)
  nodeType: NodeType;
}
