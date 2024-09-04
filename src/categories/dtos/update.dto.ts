import { Category } from '../category.model';
import { ID, OmitType, PartialType, Field, InputType } from '@nestjs/graphql';

@InputType()
export class CategoryChange extends PartialType(OmitType(Category, ['_id', 'services'] as const), InputType) {
  @Field(() => [ID], { nullable: true })
  services: string[];
}

