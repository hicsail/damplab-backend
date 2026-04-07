import { InputType, OmitType, ID, Field } from '@nestjs/graphql';
import { Bundle } from '../bundles.model';

@InputType()
export class CreateBundle extends OmitType(Bundle, ['id', 'services'] as const, InputType) {
  @Field(() => [ID], { nullable: true })
  services: string[];
}
