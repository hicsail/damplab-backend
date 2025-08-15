import { InputType, Field, ID } from '@nestjs/graphql';

@InputType()
export class CreateBundleInput {
  @Field()
  label: string;

  @Field({ nullable: true })
  icon?: string;

  @Field(() => [ID])
  services: string[]; 
}
