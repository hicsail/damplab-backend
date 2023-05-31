import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class BundleInput {
  @Field({ description: 'Human assigned ID' })
  id: string;

  @Field({ description: 'Bundle name' })
  label: string;

  @Field({ description: 'Icon of the bundle' })
  icon: string;

  @Field(() => [String], { description: 'List of services represented using the human assigned ID' })
  services: string[];
}
