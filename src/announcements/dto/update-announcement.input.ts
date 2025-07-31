import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class UpdateAnnouncementInput {

  @Field(() => Boolean)
  is_displayed: boolean;
}

