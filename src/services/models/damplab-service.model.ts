import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Field, ID, ObjectType, Float, registerEnumType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';
import mongoose from 'mongoose';
import { Pricing } from '../../pricing/pricing.model';

/**
 * A DampLabService represents one of the services offered by DampLab.
 *
 * It represents what the services takes in as inputs and what it produces.
 * The DampLabService also contains information on how this services can
 * be connected to other serivces to make a workflow.
 */
export enum ServicePricingMode {
  SERVICE = 'SERVICE',
  PARAMETER = 'PARAMETER'
}

registerEnumType(ServicePricingMode, { name: 'ServicePricingMode' });

@Schema()
@ObjectType({ description: 'Services supported by the DampLab' })
export class DampLabService {
  @Field(() => ID, { description: 'unique database generated ID', name: 'id' })
  _id: string;

  @Prop()
  @Field({ description: 'Human readable name of the service' })
  name: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Service category number for downstream integrations.' })
  serviceCategoryNumber?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Service category name for downstream integrations.' })
  serviceCategoryName?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Service unit for downstream integrations.' })
  unit?: string;

  @Prop()
  @Field({ description: 'URL to the icon of the service' })
  icon: string;

  @Prop({ type: mongoose.Schema.Types.Mixed })
  @Field(() => JSON, {
    description:
      'Parameters that are part of the service. Each parameter may include allowMultipleValues (boolean, default false) and price (number). When allowMultipleValues is true, formData values may be stored and returned as string[].'
  })
  parameters: any;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  @Field(() => JSON, { description: 'If there are grouped parameters', nullable: true })
  paramGroups: any[];

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: DampLabService.name }] })
  @Field(() => [DampLabService], { description: 'List of services this service can connect to' })
  allowedConnections: mongoose.Types.ObjectId[];

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  @Field(() => JSON, { description: 'The by-product of the service', nullable: true })
  result?: any;

  @Prop({ required: false })
  @Field(() => [String], { description: 'The expected fields in the result of the service', nullable: true })
  resultParams?: string[];

  @Prop()
  @Field()
  description: string;

  @Prop({ required: false })
  @Field(() => Float, {
    nullable: true,
    description: 'The approximate cost to use this service when pricingMode is SERVICE.'
  })
  price?: number;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  @Field(() => Pricing, {
    nullable: true,
    description: 'Pricing by customer category for this service. Prefer this over price/internalPrice/externalPrice.'
  })
  pricing?: Pricing;

  @Prop({ required: false })
  @Field(() => Float, {
    nullable: true,
    description: 'Customer-category specific price for INTERNAL customers when pricingMode is SERVICE. Falls back to price when unset.',
    deprecationReason: 'Use pricing.internal instead.'
  })
  internalPrice?: number;

  @Prop({ required: false })
  @Field(() => Float, {
    nullable: true,
    description: 'Customer-category specific price for EXTERNAL customers when pricingMode is SERVICE. Falls back to price when unset.',
    deprecationReason: 'Use pricing.external instead.'
  })
  externalPrice?: number;

  @Prop({ required: false })
  @Field(() => Float, {
    nullable: true,
    description: 'Customer-category specific price for EXTERNAL ACADEMIC customers when pricingMode is SERVICE.',
    deprecationReason: 'Use pricing.externalAcademic instead.'
  })
  externalAcademicPrice?: number;

  @Prop({ required: false })
  @Field(() => Float, {
    nullable: true,
    description: 'Customer-category specific price for EXTERNAL MARKET customers when pricingMode is SERVICE.',
    deprecationReason: 'Use pricing.externalMarket instead.'
  })
  externalMarketPrice?: number;

  @Prop({ required: false })
  @Field(() => Float, {
    nullable: true,
    description: 'Customer-category specific price for EXTERNAL NO-SALARY customers when pricingMode is SERVICE.',
    deprecationReason: 'Use pricing.externalNoSalary instead.'
  })
  externalNoSalaryPrice?: number;

  @Prop({ required: false, default: ServicePricingMode.SERVICE })
  @Field(() => ServicePricingMode, {
    nullable: true,
    defaultValue: ServicePricingMode.SERVICE,
    description: 'How pricing is determined for this service.'
  })
  pricingMode?: ServicePricingMode;

  @Prop({ type: [String], required: false, default: [] })
  @Field(() => [String], {
    description: 'Array of deliverable descriptions for this service',
    defaultValue: []
  })
  deliverables!: string[];
}

export type DampLabServiceDocument = DampLabService & Document;
export const DampLabServiceSchema = SchemaFactory.createForClass(DampLabService);
