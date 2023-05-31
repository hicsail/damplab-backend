import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class CategoryInput {
  @Field({ description: 'Human assigned ID' })
  id: string;

  @Field({ description: 'Name of the category' })
  label: string;
}
