import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID, Float } from '@nestjs/graphql';

/**
 * Usage-based billing (inventory bookings), kept SEPARATE from the job-coupled
 * SOW/Invoice models on purpose: those have a non-sparse unique index on `job`
 * that would reject multiple job-less documents, and migrating it on the live
 * billing collection is risky. These mirror the structure the existing PDF
 * templates expect, mapped on the frontend.
 */

@ObjectType({ description: 'One line on a usage SOW/invoice — a single booking rolled up for billing.' })
export class UsageLineItem {
  @Field(() => ID, { name: 'id', description: 'Booking id this line came from.' })
  bookingId: string;

  @Field({ description: 'Item name (e.g. "Bioanalyzer").' })
  label: string;

  @Field({ description: 'Human-readable usage detail (e.g. "3.5 hrs @ $40.00/hr" or "200 units @ $0.10/unit").' })
  detail: string;

  @Field({ description: 'When the usage occurred (ISO string).', nullable: true })
  usedAt?: string;

  @Field(() => Float, { description: 'Line cost.' })
  cost: number;
}

@Schema({ timestamps: true })
@ObjectType({ description: 'A usage-based Statement of Work generated from a user’s inventory bookings.' })
export class UsageSow {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ required: true, unique: true })
  @Field({ description: 'Unique SOW number (e.g. "USAGE-SOW-001").' })
  sowNumber: string;

  @Prop({ required: true, default: () => new Date() })
  @Field()
  date: Date;

  @Prop({ required: false })
  @Field({ nullable: true })
  title?: string;

  // Bill-to (the booking owner)
  @Prop({ required: true, index: true })
  @Field({ description: 'Keycloak sub of the billed user.' })
  billToSub: string;

  @Prop({ required: true })
  @Field()
  billToName: string;

  @Prop({ required: true })
  @Field()
  billToEmail: string;

  @Prop({ required: false })
  @Field({ nullable: true })
  billToInstitution?: string;

  @Prop({ required: false })
  @Field({ nullable: true })
  customerCategory?: string;

  @Prop({ type: [{ type: mongoose.Schema.Types.Mixed }], required: true })
  @Field(() => [UsageLineItem])
  lineItems: UsageLineItem[];

  @Prop({ required: true })
  @Field(() => Float)
  totalCost: number;

  @Prop({ required: true })
  @Field()
  terms: string;

  @Prop({ required: false })
  @Field({ nullable: true })
  additionalInformation?: string;

  @Prop({ required: true })
  @Field()
  createdBy: string;

  @Prop({ required: true, default: () => new Date() })
  @Field()
  createdAt: Date;
}

@Schema({ timestamps: true })
@ObjectType({ description: 'A usage-based invoice generated from a user’s inventory bookings.' })
export class UsageInvoice {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ required: true, unique: true })
  @Field({ description: 'Unique invoice number (e.g. "USAGE-INV-001").' })
  invoiceNumber: string;

  @Prop({ required: true, default: () => new Date() })
  @Field()
  invoiceDate: Date;

  @Prop({ required: false, index: true })
  @Field(() => ID, { nullable: true, description: 'The usage SOW this invoice was generated alongside.' })
  sowId?: string;

  @Prop({ required: true, index: true })
  @Field()
  billToSub: string;

  @Prop({ required: true })
  @Field()
  billToName: string;

  @Prop({ required: true })
  @Field()
  billToEmail: string;

  @Prop({ required: false })
  @Field({ nullable: true })
  billToInstitution?: string;

  @Prop({ required: false })
  @Field({ nullable: true })
  customerCategory?: string;

  @Prop({ type: [{ type: mongoose.Schema.Types.Mixed }], required: true })
  @Field(() => [UsageLineItem])
  lineItems: UsageLineItem[];

  @Prop({ required: true })
  @Field(() => Float)
  totalCost: number;

  @Prop({ required: true })
  @Field()
  createdBy: string;

  @Prop({ required: true, default: () => new Date() })
  @Field()
  createdAt: Date;
}

@ObjectType({ description: 'Result of generating usage billing: the SOW + invoice created together.' })
export class UsageBillingResult {
  @Field(() => UsageSow)
  sow: UsageSow;

  @Field(() => UsageInvoice)
  invoice: UsageInvoice;
}

export type UsageSowDocument = UsageSow & Document;
export type UsageInvoiceDocument = UsageInvoice & Document;
export const UsageSowSchema = SchemaFactory.createForClass(UsageSow);
export const UsageInvoiceSchema = SchemaFactory.createForClass(UsageInvoice);

UsageSowSchema.index({ billToSub: 1, createdAt: -1 });
UsageInvoiceSchema.index({ billToSub: 1, createdAt: -1 });
