import { Bundle } from '../models/bundle.model';
import { ID, InputType, OmitType, PartialType, Field } from '@nestjs/graphql';

@InputType()
export class BundleChange extends PartialType(OmitType(Bundle, ['id', 'services'] as const), InputType) {
  @Field(() => [ID], { nullable: true })
  services: string[];
}
