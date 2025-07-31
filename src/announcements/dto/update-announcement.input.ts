import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class UpdateAnnouncementInput {
  @Field(() => Boolean, { nullable: true })
  is_displayed?: boolean;
}
