import { Field, InputType, OmitType } from '@nestjs/graphql';
import { DampNode, PipetteNode, MixerNode } from '../models/node.model';

/**
 * Describes the shared properties needed when adding a new node
 */
@InputType()
export abstract class AddNodeInput {
  orderId: string;
  node: Omit<Omit<DampNode, 'id'>, 'nodeType'>;
}

@InputType()
export class PipetteNodeInput extends OmitType(PipetteNode, ['id', 'nodeType'] as const, InputType) {}

@InputType()
export class AddPipetteNodeInput implements AddNodeInput {
  @Field()
  orderId: string;

  @Field(() => PipetteNodeInput)
  node: PipetteNodeInput;
}

@InputType()
export class MixerNodeInput extends OmitType(MixerNode, ['id', 'nodeType'] as const, InputType) {}

@InputType()
export class AddMixerNodeInput implements AddNodeInput {
  @Field()
  orderId: string;

  @Field(() => MixerNodeInput)
  node: MixerNodeInput;
}
