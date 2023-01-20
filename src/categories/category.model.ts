import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { DampLabService } from '../services/models/damplab-service.model';
import mongoose from 'mongoose';
import { Field, ID, ObjectType } from '@nestjs/graphql';

@Schema()
@ObjectType({ description: 'Represents a category of DampLab services' })
export class Category {
  /** Database generated ID */
  @Field(() => ID, { name: 'id', description: 'unique database generated ID' })
  _id: string;

  @Prop()
  @Field()
  label: string;

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: DampLabService.name }] })
  @Field(() => [DampLabService], { description: 'List of DampLab services in this category' })
  services: mongoose.Types.ObjectId[];
}

export type CategoryDocument = Category & mongoose.Document;
export const CategorySchema = SchemaFactory.createForClass(Category);
