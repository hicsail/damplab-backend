import { Field, ObjectType, InputType } from '@nestjs/graphql';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ collection: 'notification_preferences' })
export class NotificationPreferencesEntity {
  @Prop({ type: String, required: true, unique: true })
  userSub: string;

  @Prop({ type: [String], default: [] })
  emailDisabledEventTypes: string[];

  @Prop({ type: [String], default: [] })
  inAppDisabledEventTypes: string[];
}

export type NotificationPreferencesDocument = NotificationPreferencesEntity & Document;
export const NotificationPreferencesSchema = SchemaFactory.createForClass(NotificationPreferencesEntity);

@ObjectType()
export class NotificationPreferences {
  @Field(() => [String])
  emailDisabledEventTypes: string[];

  @Field(() => [String])
  inAppDisabledEventTypes: string[];
}

@InputType()
export class UpdateNotificationPreferencesInput {
  @Field(() => [String], { nullable: true })
  emailDisabledEventTypes?: string[];

  @Field(() => [String], { nullable: true })
  inAppDisabledEventTypes?: string[];
}
