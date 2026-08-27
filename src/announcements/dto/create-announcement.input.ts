import { InputType, Field } from '@nestjs/graphql';
import { AnnouncementAudience } from '../announcement-audience';

@InputType()
export class CreateAnnouncementInput {
  @Field()
  text: string;

  @Field({ nullable: true })
  timestamp?: Date;

  @Field(() => Boolean, { nullable: true })
  is_displayed?: boolean;

  /**
   * Omit to address everyone. **An empty list is rejected**, deliberately: on a
   * stored row, empty means "written before audiences existed, so show it to
   * everyone", and that reading has to stay unambiguous. Without this validation
   * an admin who unchecked all four boxes intending "nobody" would publish to
   * everybody — the exact opposite of what they asked for.
   */
  @Field(() => [AnnouncementAudience], { nullable: true, description: 'Omit for everyone. An empty list is an error, not "nobody".' })
  audienceRoles?: AnnouncementAudience[];
}
