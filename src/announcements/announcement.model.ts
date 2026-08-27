import { ObjectType, Field, ID } from '@nestjs/graphql';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { AnnouncementAudience } from './announcement-audience';

@Schema()
@ObjectType()
export class Announcement extends Document {
  /**
   * There was no `id` field on this type at all. `timestamp` was the de facto key
   * — which is why edit and delete did not exist, and why `updateAnnouncement`
   * still looks a row up by the second it was created.
   */
  @Field(() => ID, { name: 'id', description: 'unique database generated id' })
  declare _id: Document['_id'];

  @Prop()
  @Field(() => String, { description: 'body text of announcement' })
  text: string;

  @Prop({ required: true })
  @Field(() => Date, { description: 'time of creation' })
  timestamp: Date;

  @Prop({ default: true, required: true })
  @Field(() => Boolean)
  is_displayed: boolean;

  /**
   * Who this announcement is for.
   *
   * **Absent or empty means visible to everyone.** That is the no-migration path:
   * every announcement written before this field existed keeps working untouched.
   *
   * The consequence is that empty must *only* ever mean "pre-migration row", so
   * the input types reject it — an admin who unchecks all four boxes intending
   * "nobody" gets an error rather than silently publishing to everyone.
   */
  @Prop({ type: [String], required: false, default: undefined })
  @Field(() => [AnnouncementAudience], {
    nullable: true,
    description: 'Which matrix columns may see this. Absent or empty means everyone — that is how announcements written before this field keep working, so the input types reject an empty list.'
  })
  audienceRoles?: AnnouncementAudience[];
}

export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);
