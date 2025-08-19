import { ObjectType, Field, ID } from '@nestjs/graphql';
import { Schema } from '@nestjs/mongoose';
import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { DampLabService } from '../../services/models/damplab-service.model';
import mongoose from 'mongoose';
import { BundleNode } from './node.model';
import { BundleEdge } from './edge.model';

@Schema()
@ObjectType()
export class Bundle {
  @Field(() => ID, { name: 'id', description: 'unique database generated id' })
  id: string;

  @Prop({ required: true })
  @Field()
  label: string;

  @Prop()
  @Field({ nullable: true })
  icon?: string;

  //@Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: DampLabService.name }] })
  //@Field(() => [DampLabService])
  //services: mongoose.Types.ObjectId[];

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: BundleNode.name }] })
  @Field(() => [BundleNode], { description: 'The nodes in the Bundle' })
  nodes: mongoose.Types.ObjectId[] | BundleNode[];

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: BundleEdge.name }] })
  @Field(() => [BundleEdge], { description: 'The edges in the Bundle' })
  edges: mongoose.Types.ObjectId[] | BundleEdge[];
}

export type BundleDocument = Bundle & mongoose.Document;
export const BundleSchema = SchemaFactory.createForClass(Bundle);
