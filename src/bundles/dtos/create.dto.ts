import { InputType, Field, ID } from '@nestjs/graphql';
import { AddBundleNodeInput } from './add-node.input';
import { AddBundleEdgeInput } from './add-edge.input';

@InputType()
export class CreateBundleInput {
  @Field()
  label: string;

  @Field({ nullable: true })
  icon?: string;

  @Field(() => [AddBundleNodeInput], { nullable: true })
  nodes?: AddBundleNodeInput[];

  @Field(() => [AddBundleEdgeInput], { nullable: true })
  edges?: AddBundleEdgeInput[];
}
