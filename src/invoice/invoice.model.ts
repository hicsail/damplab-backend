import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID, Float } from '@nestjs/graphql';
import { Job } from '../job/job.model';

@Schema()
@ObjectType({ description: 'Service line item captured on an invoice (snapshot at time of generation)' })
export class InvoiceServiceLineItem {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ required: true })
  @Field({ description: 'Service ID from DampLabService' })
  serviceId: string;

  @Prop({ required: true })
  @Field({ description: 'Name of the service' })
  name: string;

  @Prop({ required: true })
  @Field({ description: 'Description of the service' })
  description: string;

  @Prop({ required: true })
  @Field(() => Float, { description: 'Cost of the service line item (already priced)' })
  cost: number;

  @Prop({ required: true })
  @Field({ description: 'Category of the service' })
  category: string;
}

@Schema()
@ObjectType({ description: 'Invoice generated for a job, optionally covering a subset of services' })
export class Invoice {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Job.name, required: true })
  @Field(() => Job, { description: 'Job this invoice is associated with' })
  job: mongoose.Types.ObjectId;

  @Prop({ required: true, index: true })
  @Field({ description: 'ID of the associated job (Mongo _id as string, for convenience/querying)' })
  jobId: string;

  @Prop({ required: true })
  @Field({ description: 'Customer-facing job identifier (5-digit numeric string)' })
  jobDisplayId: string;

  @Prop({ required: true })
  @Field({ description: 'Job name captured at invoice creation time' })
  jobName: string;

  @Prop({ required: true, index: true })
  @Field({ description: 'Invoice number, unique per job (e.g., "04217-001")' })
  invoiceNumber: string;

  @Prop({ required: true })
  @Field({ description: 'When the invoice was generated' })
  invoiceDate: Date;

  @Prop({ required: true })
  @Field({ description: 'User who generated the invoice (technician username/email)' })
  createdBy: string;

  @Prop({ type: [{ type: mongoose.Schema.Types.Mixed }], required: true })
  @Field(() => [InvoiceServiceLineItem], { description: 'Service line items included on this invoice' })
  services: InvoiceServiceLineItem[];

  @Prop({ required: true })
  @Field(() => Float, { description: 'Total cost of the invoice (sum of services)' })
  totalCost: number;

  // Billing snapshot (copied from SOW at creation time)
  @Prop({ required: true })
  @Field({ description: 'Billing contact name' })
  billedToName: string;

  @Prop({ required: true })
  @Field({ description: 'Billing contact email' })
  billedToEmail: string;

  @Prop({ required: false })
  @Field({ description: 'Billing address (freeform)', nullable: true })
  billedToAddress?: string;

  @Prop({ required: false })
  @Field({ description: 'Customer category used for pricing (if known)', nullable: true })
  customerCategory?: string;

  @Prop({ required: true, default: new Date() })
  @Field({ description: 'Date when the invoice record was created' })
  createdAt: Date;
}

export type InvoiceDocument = Invoice & Document;
export const InvoiceSchema = SchemaFactory.createForClass(Invoice);

InvoiceSchema.index({ jobId: 1, createdAt: -1 });
InvoiceSchema.index({ jobId: 1, invoiceNumber: 1 }, { unique: true });
