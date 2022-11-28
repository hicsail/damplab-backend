import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';
import mongoose from 'mongoose';

/**
 * A DampLabService represents one of the services offered by DampLab.
 *
 * It represents what the services takes in as inputs and what it produces.
 * The DampLabService also contains information on how this services can
 * be connected to other serivces to make a workflow.
 */
@Schema()
@ObjectType({ description: 'Services supported by the DampLab' })
export class DampLabService {
  @Field(() => ID, { description: 'unique database generated ID' })
  _id: string;

  @Prop()
  @Field({ description: 'Human readable name of the service' })
  name: string;

  @Prop()
  @Field({ description: 'URL to the icon of the service' })
  icon: string;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  @Field(() => JSON, { description: 'Parameters that are part of the service' })
  parameters: any;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  @Field(() => JSON, { description: 'Parameters defined earlier in the graph' })
  flowParams?: any;

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: DampLabService.name }] })
  @Field(() => [DampLabService!]!, { description: 'List of services this service can connect to' })
  allowedConnections: mongoose.Types.ObjectId[];

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  @Field(() => JSON, { description: 'The by-product of the service' })
  result?: any;

  @Prop({ required: false })
  @Field(() => [String], { description: 'The expected fields in the result of the service' })
  resultParams?: string[];
}

export type DampLabServiceDocument = DampLabService & Document;
export const DampLabServiceSchema = SchemaFactory.createForClass(DampLabService);
