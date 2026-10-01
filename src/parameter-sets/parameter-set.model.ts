import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';

/**
 * A reusable, named group of operation parameters. Live, not a template: an
 * operation references the set by id, so editing the set changes every operation
 * using it — including prices for nodes priced afterwards.
 */
@Schema({ timestamps: true })
@ObjectType({ description: 'A reusable group of parameters that operations reference by id.' })
export class ParameterSet {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ required: true, unique: true })
  @Field({ description: 'Unique (case-insensitively) and may not contain ";".' })
  name: string;

  @Prop({ required: false })
  @Field({ nullable: true })
  description?: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: [] })
  @Field(() => JSON, { description: 'Same shape as DampLabService.parameters; paramGroupId is not stored.' })
  parameters: any[];

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

export type ParameterSetDocument = ParameterSet & Document;
export const ParameterSetSchema = SchemaFactory.createForClass(ParameterSet);
