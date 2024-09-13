import { ID, InputType, OmitType, Field } from '@nestjs/graphql';
import { Category } from '../category.model';

@InputType()
export class CreateCategory extends OmitType(Category, ['_id', 'services'] as const, InputType) {
  @Field(() => [ID])
  services: string[];
}
