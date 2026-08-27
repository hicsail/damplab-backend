import { InputType, Field, ID } from '@nestjs/graphql';
import { AnnouncementAudience } from '../announcement-audience';

@InputType()
export class UpdateAnnouncementInput {
  /**
   * The announcement's id.
   *
   * `timestamp` used to be the key — the type had no id at all — which is why
   * this mutation could only ever flip `is_displayed`, and why editing the text
   * did not exist. Kept nullable alongside `id` so an existing caller passing a
   * timestamp is not broken; `id` wins when both are given.
   */
  @Field(() => ID, { nullable: true })
  id?: string;

  @Field({ nullable: true, deprecationReason: 'Use id. Timestamp was the de facto key before the type exposed one.' })
  timestamp?: Date;

  @Field({ nullable: true, description: 'New body text. Omit to leave it unchanged.' })
  text?: string;

  @Field(() => Boolean, { nullable: true })
  is_displayed?: boolean;

  /** As on create: omit for everyone, empty is an error. */
  @Field(() => [AnnouncementAudience], { nullable: true, description: 'Omit to leave unchanged. An empty list is an error, not "nobody".' })
  audienceRoles?: AnnouncementAudience[];
}
