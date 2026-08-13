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

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' }], required: false, default: [] })
  @Field(() => [String], {
    nullable: true,
    description:
      'Inventory items this service typically needs. Informational (soft requirement): the lab monitor surfaces these in the picker but does not block the IN_PROGRESS transition if none are selected.'
  })
  inventoryRequirements?: mongoose.Types.ObjectId[];

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

  @Prop({ default: false })
  @Field(() => Boolean, {
    nullable: true,
    defaultValue: false,
    description:
      'When true, a canvas node for this service offers a "Number of runs" count, and its price is multiplied by it. Off by default: most operations run once, and an always-present run count is noise on every node. Affects only what the editor offers going forward — a run count already stored on a submitted job keeps pricing and displaying either way, so turning this off never silently reprices history.'
  })
  allowMultipleRuns?: boolean;

  @Prop({ type: [String], required: false, default: [] })
  @Field(() => [String], {
    description: 'Array of deliverable descriptions for this service',
    defaultValue: []
  })
  deliverables!: string[];

  @Prop({ required: false })
  @Field({
    nullable: true,
    description: 'Free-text internal notes for DAMPLab staff. Not shown to customers.'
  })
  notes?: string;

  /**
   * @deprecated Superseded by {@link protocolIds}. Retained so historical
   * documents keep resolving; `normalizeService` folds it into `protocolIds`
   * when the array is absent. Do not write to it.
   */
  @Prop({ required: false })
  @Field({
    nullable: true,
    deprecationReason: 'Use protocolIds — an operation can have several protocols in sequence.',
    description: 'Legacy single protocols.io identifier. Read via protocolIds instead.'
  })
  protocolId?: string;

  @Prop({ type: [String], default: [] })
  @Field(() => [String], {
    description:
      'protocols.io protocol identifiers for this operation, IN EXECUTION ORDER — array position is the sequence the admin specified. Each entry is the short id from the protocol URL (e.g. "n92ld46yxl5b" from protocols.io/view/...-n92ld46yxl5b/v1). References only; protocol content is fetched on demand and never synced into our DB. Note a protocol may be shared by several operations, in which case they share its step→equipment map.'
  })
  protocolIds: string[];

  @Prop({ default: false })
  @Field(() => Boolean, {
    nullable: true,
    defaultValue: false,
    description: 'When true, the service is soft-deleted: hidden from catalogs and connection pickers but still resolvable for historical workflows.'
  })
  isDeleted?: boolean;
}

export type DampLabServiceDocument = DampLabService & Document;
export const DampLabServiceSchema = SchemaFactory.createForClass(DampLabService);
