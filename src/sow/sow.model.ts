import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID, registerEnumType, Float, Int } from '@nestjs/graphql';
import JSON from 'graphql-type-json';
import { Job } from '../job/job.model';

export enum SOWStatus {
  DRAFT = 'DRAFT',
  FINAL = 'FINAL',
  SENT = 'SENT',
  SIGNED = 'SIGNED',
  CANCELLED = 'CANCELLED'
}
registerEnumType(SOWStatus, { name: 'SOWStatus' });

export enum SOWAdjustmentType {
  DISCOUNT = 'DISCOUNT',
  ADDITIONAL_COST = 'ADDITIONAL_COST',
  SPECIAL_TERM = 'SPECIAL_TERM'
}
registerEnumType(SOWAdjustmentType, { name: 'SOWAdjustmentType' });

export enum SOWSignatureRole {
  CLIENT = 'CLIENT',
  TECHNICIAN = 'TECHNICIAN'
}
registerEnumType(SOWSignatureRole, { name: 'SOWSignatureRole' });

/**
 * Signature data stored per signer (client or technician).
 * Stored as JSON/Mixed in MongoDB; represented as this type in GraphQL.
 */
@ObjectType({ description: 'Signature on a Statement of Work (name, title, date, optional image)' })
export class SOWSignature {
  @Field({ description: 'Full name as shown on the PDF' })
  name: string;

  @Field({ description: 'Role/title (e.g. Principal Investigator)', nullable: true })
  title?: string;

  @Field({ description: 'ISO 8601 date-time when they signed' })
  signedAt: string;

  @Field({
    description: 'Data URL of the signature image (e.g. data:image/png;base64,...)',
    nullable: true
  })
  signatureDataUrl?: string;
}

@Schema()
@ObjectType({ description: 'Timeline information for a Statement of Work' })
export class SOWTimeline {
  @Prop({ required: true })
  @Field({ description: 'Start date of the project' })
  startDate: Date;

  @Prop({ required: true })
  @Field({ description: 'End date of the project' })
  endDate: Date;

  @Prop({ required: true })
  @Field({ description: 'Duration of the project (e.g., "14 days", "5 weeks")' })
  duration: string;
}

@Schema()
@ObjectType({ description: 'Resource allocation for a Statement of Work' })
export class SOWResources {
  @Prop({ required: true })
  @Field({ description: 'Project manager assigned to the project' })
  projectManager: string;

  @Prop({ required: true })
  @Field({ description: 'Project lead assigned to the project' })
  projectLead: string;
}

@Schema()
@ObjectType({ description: 'Pricing adjustment for a Statement of Work' })
export class SOWPricingAdjustment {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ required: true })
  @Field(() => SOWAdjustmentType, { description: 'Type of adjustment' })
  type: SOWAdjustmentType;

  @Prop({ required: true })
  @Field({ description: 'Description of the adjustment' })
  description: string;

  @Prop({ required: true })
  @Field(() => Float, { description: 'Amount of the adjustment' })
  amount: number;

  @Prop({ required: false })
  @Field({ description: 'Reason for the adjustment', nullable: true })
  reason?: string;
}

@Schema()
@ObjectType({ description: 'Discount information for a Statement of Work' })
export class SOWDiscount {
  @Prop({ required: true })
  @Field(() => Float, { description: 'Discount amount' })
  amount: number;

  @Prop({ required: true })
  @Field({ description: 'Reason for the discount' })
  reason: string;
}

@Schema()
@ObjectType({ description: 'Pricing information for a Statement of Work' })
export class SOWPricing {
  @Prop({ required: true })
  @Field(() => Float, { description: 'Base cost before adjustments' })
  baseCost: number;

  @Prop({ type: [{ type: mongoose.Schema.Types.Mixed }], default: [] })
  @Field(() => [SOWPricingAdjustment], { description: 'List of pricing adjustments' })
  adjustments: SOWPricingAdjustment[];

  @Prop({ required: true })
  @Field(() => Float, { description: 'Total cost after adjustments' })
  totalCost: number;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  @Field(() => SOWDiscount, { description: 'Discount applied to the pricing', nullable: true })
  discount?: SOWDiscount;
}

@Schema()
@ObjectType({ description: 'Service included in a Statement of Work' })
export class SOWService {
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
  @Field(() => Float, { description: 'Cost of the service' })
  cost: number;

  @Prop({ required: true })
  @Field({ description: 'Category of the service' })
  category: string;
}

@Schema({ _id: false })
@ObjectType({ description: 'A question a customer asked about a SOW, or a staff reply' })
export class SowQuestion {
  @Prop({ required: true })
  @Field({ description: 'Keycloak sub of the author' })
  authorSub: string;

  @Prop({ required: true, default: '' })
  @Field({ defaultValue: '' })
  authorName: string;

  @Prop({ required: true, default: false })
  @Field({ description: 'True when written by DampLab staff rather than the customer' })
  isStaff: boolean;

  @Prop({ required: true })
  @Field()
  text: string;

  @Prop({ required: false })
  @Field(() => Int, { nullable: true, description: 'Version the question was asked against' })
  versionNumber?: number;

  @Prop({ required: true, default: () => new Date() })
  @Field()
  createdAt: Date;
}

@Schema()
@ObjectType({ description: 'Statement of Work (SOW) for a job' })
export class SOW {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ required: true, unique: true })
  @Field({ description: 'Unique SOW number (e.g., "SOW 001", "SOW 002")' })
  sowNumber: string;

  @Prop({ required: true, default: new Date() })
  @Field({ description: 'Date the SOW was created' })
  date: Date;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: Job.name, required: true, unique: true })
  @Field(() => Job, { description: 'Job this SOW is associated with' })
  job: mongoose.Types.ObjectId;

  @Prop({ required: true })
  @Field({ description: 'ID of the associated job (for convenience/querying)' })
  jobId: string;

  @Prop({ required: true })
  @Field({ description: 'Name of the job' })
  jobName: string;

  @Prop({ required: false })
  @Field({
    description: 'Technician-entered title for the SOW document (e.g. "Agreement to Perform Research Services")',
    nullable: true
  })
  sowTitle?: string;

  // Client Information
  @Prop({ required: true })
  @Field({ description: 'Name of the client' })
  clientName: string;

  @Prop({ required: true })
  @Field({ description: 'Email address of the client' })
  clientEmail: string;

  @Prop({ required: true })
  @Field({ description: 'Institution of the client' })
  clientInstitution: string;

  @Prop({ required: false })
  @Field({ description: 'Address of the client', nullable: true })
  clientAddress?: string;

  // SOW Content
  @Prop({ type: [String], required: true })
  @Field(() => [String], { description: 'Array of scope of work bullet points' })
  scopeOfWork: string[];

  @Prop({ type: [String], required: true })
  @Field(() => [String], { description: 'Array of deliverable descriptions' })
  deliverables: string[];

  @Prop({ type: [{ type: mongoose.Schema.Types.Mixed }], required: true })
  @Field(() => [SOWService], { description: 'Services included in the SOW' })
  services: SOWService[];

  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  @Field(() => SOWTimeline, { description: 'Timeline information' })
  timeline: SOWTimeline;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  @Field(() => SOWResources, { description: 'Resource allocation' })
  resources: SOWResources;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  @Field(() => SOWPricing, { description: 'Pricing information' })
  pricing: SOWPricing;

  /**
   * Legacy. The document's terms now live in its versions' fields, where staff can
   * edit them; nothing reads this any more. Kept, and kept optional, so existing
   * rows keep their stored copy while newly generated SOWs simply have none.
   */
  @Prop({ required: false })
  @Field({ description: 'Terms and conditions. Legacy — the live document text lives on the SOW version.', nullable: true })
  terms?: string;

  @Prop({ required: false })
  @Field({ description: 'Additional information', nullable: true })
  additionalInformation?: string;

  // Metadata
  @Prop({ required: true, default: new Date() })
  @Field({ description: 'Date when the SOW was created' })
  createdAt: Date;

  @Prop({ required: true, default: new Date() })
  @Field({ description: 'Date when the SOW was last updated' })
  updatedAt: Date;

  @Prop({ required: true })
  @Field({ description: 'User who created the SOW (technician username/email)' })
  createdBy: string;

  @Prop({ required: true, default: SOWStatus.DRAFT })
  @Field(() => SOWStatus, { description: 'Current status of the SOW' })
  status: SOWStatus;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  @Field(() => SOWSignature, { description: 'Client signature (when present)', nullable: true })
  clientSignature?: SOWSignature;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  @Field(() => SOWSignature, { description: 'Technician/BU signature (when present)', nullable: true })
  technicianSignature?: SOWSignature;

  // ---------------------------------------------------------------------------
  // Versioned document. The fields above remain the billing core (services,
  // pricing) plus the legacy record that predates versioning; the document
  // itself lives in the sow_versions collection.
  // ---------------------------------------------------------------------------

  @Prop({ required: true, default: 0 })
  @Field(() => Int, { description: 'Highest version number; what staff edit. 0 before the first version exists.' })
  currentVersionNumber: number;

  @Prop({ required: true, default: 0 })
  @Field(() => Int, {
    description: 'Version in force with the customer. Lags currentVersionNumber while staff draft changes, which is why an unsent draft never invalidates a signature. 0 before anything is issued.'
  })
  activeVersionNumber: number;

  @Prop({ required: true, default: false })
  @Field({
    description:
      'The billing core moved (workflow added, category changed) since the current version was written, so its Fee Schedule is out of date. Surfaced to staff as a banner; never auto-applied to an issued document.'
  })
  documentStale: boolean;

  @Prop({ type: [mongoose.Schema.Types.Mixed], default: [] })
  @Field(() => [SowQuestion], { description: 'Append-only question thread between the customer and staff' })
  questions: SowQuestion[];
}

export type SOWDocument = SOW & Document;
export const SOWSchema = SchemaFactory.createForClass(SOW);

// Create indexes
SOWSchema.index({ jobId: 1 });
SOWSchema.index({ sowNumber: 1 });
SOWSchema.index({ status: 1 });
SOWSchema.index({ createdAt: 1 });
