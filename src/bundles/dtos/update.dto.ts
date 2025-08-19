import { Bundle } from '../models/bundle.model';
import { ID, InputType, OmitType, PartialType, Field } from '@nestjs/graphql';
import { AddBundleNodeInput } from './add-node.input';
import { AddBundleEdgeInput } from './add-edge.input';

@InputType()
export class UpdateBundleInput extends PartialType(
  OmitType(Bundle, ['id', 'nodes', 'edges'] as const), 
  InputType
) {
  @Field(() => [AddBundleNodeInput], { nullable: true })
  nodes?: AddBundleNodeInput[];

  @Field(() => [AddBundleEdgeInput], { nullable: true })
  edges?: AddBundleEdgeInput[];
}