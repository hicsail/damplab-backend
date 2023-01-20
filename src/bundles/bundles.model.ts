import { ObjectType, Field, ID } from '@nestjs/graphql';
import { Schema } from '@nestjs/mongoose';
import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { DampLabService } from 'src/services/models/damplab-service.model';
import mongoose from 'mongoose';

@Schema()
@ObjectType()
export class Bundle {
  @Field(() => ID, { name: 'id', description: 'unique database generated id' })
  id: string;

  @Prop()
  @Field()
  label: string;

  @Prop()
  @Field()
  icon: string;

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: DampLabService.name }] })
  @Field(() => [DampLabService])
  services: mongoose.Types.ObjectId[];
}

export type BundleDocument = Bundle & mongoose.Document;
export const BundleSchema = SchemaFactory.createForClass(Bundle);
