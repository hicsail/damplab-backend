import { InputType, Field } from '@nestjs/graphql';

@InputType()
export class CreateAnnouncementInput {
  @Field()
  text: string;

  @Field({ nullable: true })
  timestamp?: Date;

  @Field(() => Boolean, { nullable: true })
  is_displayed?: boolean;
}
