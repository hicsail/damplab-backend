import { ObjectType, Field } from '@nestjs/graphql';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema()
@ObjectType()
export class Announcement extends Document {
  @Prop()
  @Field(() => String, { description: 'body text of announcement' })
  text: string;

  @Prop({ required: true })
  @Field(() => Date, { description: 'time of creation' })
  timestamp: Date;

  @Prop({ default: true, required: true })
  @Field(() => Boolean)
  is_displayed: boolean;
}

export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);
