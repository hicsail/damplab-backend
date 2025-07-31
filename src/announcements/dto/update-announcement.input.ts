import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class UpdateAnnouncementInput {
  @Field()
  timestamp?: Date;

  @Field(() => Boolean)
  is_displayed: boolean;
}
