//schema for announcement feature

import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import mongoose from 'mongoose';

@Schema()
@ObjectType()
export class Announcement extends Document{

  @Prop()
  @Field({ description: 'body text of announcement' })
  text: string;

  @Prop()
  @Field({ description: 'timestamp' })
  timestamp: string;

  @Prop()
  @Field()
  is_display: boolean;

}
