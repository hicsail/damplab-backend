import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/** One subscription token per user. Not a GraphQL type: it is never exposed as a field. */
@Schema({ collection: 'calendar_feed_tokens' })
export class CalendarFeedToken {
  @Prop({ required: true, unique: true })
  userSub: string;

  @Prop({ required: true, unique: true })
  token: string;

  @Prop({ required: true })
  createdAt: Date;
}

export type CalendarFeedTokenDocument = CalendarFeedToken & Document;
export const CalendarFeedTokenSchema = SchemaFactory.createForClass(CalendarFeedToken);
