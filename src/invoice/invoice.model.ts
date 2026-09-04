import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID, Float, Int } from '@nestjs/graphql';
import { Job } from '../job/job.model';
import { SOWAdjustmentType } from '../sow/sow.model';
import { PricingDetail } from '../pricing/pricing.model';

/**
 * A SOW pricing adjustment as applied to THIS invoice (snapshot at generation).
 *
 * SOW adjustments are fixed dollar amounts against the whole job, but an invoice
 * may cover only some of the job's services. So each adjustment is prorated by
 * this invoice's share of the SOW base cost, and both figures are kept: `amount`
 * is the original whole-job figure (for transparency on the document) and
 * `appliedAmount` is what actually moved this invoice's total. Prorating means
 * every invoice for a job sums to the SOW total with no double-crediting.
 *
 * SPECIAL_TERM carries no monetary effect, matching SOWService.calculateAdjustmentsTotal —
 * it rides along as a note with appliedAmount 0.
 */
@Schema()
@ObjectType({ description: 'A SOW pricing adjustment as applied to this invoice (prorated for partial invoices).' })
export class InvoiceAdjustment {
  @Prop({ required: true })
  @Field(() => SOWAdjustmentType, { description: 'DISCOUNT reduces, ADDITIONAL_COST increases, SPECIAL_TERM is a note only.' })
  type: SOWAdjustmentType;

  @Prop({ required: true })
  @Field({ description: 'Description carried over from the SOW.' })
  description: string;

  @Prop({ required: false })
  @Field({ description: 'Reason carried over from the SOW.', nullable: true })
  reason?: string;

  @Prop({ required: true })
  @Field(() => Float, { description: 'The original whole-job adjustment amount from the SOW.' })
  amount: number;

  @Prop({ required: true })
  @Field(() => Float, {
    description: 'The portion actually applied to this invoice (signed: negative for DISCOUNT, positive for ADDITIONAL_COST, 0 for SPECIAL_TERM).'
  })
  appliedAmount: number;

  @Prop({ required: true, default: 1 })
  @Field(() => Float, { description: "This invoice's share of the SOW base cost (1 = the invoice covers the whole job)." })
  prorationFactor: number;
}

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

  /**
   * The three figures below are what let an invoice state the same pricing basis
   * its SOW does. The Fee Schedule prints "$unitCost x multiplier = $cost" from
   * exactly these; the invoice used to keep only `cost`, so a line the SOW
   * explained as "$50.00 x 4" appeared on the invoice as an unexplained $200.00.
   *
   * Nullable because lines written before unit prices were recorded have no
   * breakdown to state — renderers must fall back to the bare total rather than
   * inventing one by dividing.
   */
  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'Price of a single run, before the multiplier. Absent on lines written before unit prices were recorded.' })
  unitCost?: number;

  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'Everything baked into cost on top of unitCost — the run count and any other multiplier parameter.' })
  multiplier?: number;

  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'The run count alone. Superseded by multiplier for display; kept to match the SOW line.' })
  runCount?: number;

  @Prop({ required: true })
  @Field({ description: 'Category of the service' })
  category: string;

  @Prop({ type: [{ type: mongoose.Schema.Types.Mixed }], required: false })
  @Field(() => [PricingDetail], { nullable: true, description: 'How unitCost was arrived at, for parameter-priced lines. Absent where there is nothing to itemise.' })
  pricingDetails?: PricingDetail[];

  /**
   * Which line of the billing source this was — the position the staff dialog
   * ticked, and the only thing that identifies a line.
   *
   * `serviceId` cannot: a job may run the same catalog service twice at two
   * different prices. Recording the position is what lets a later invoice for
   * the same job see that this line is already billed. Nullable, because
   * invoices written before this existed cannot say.
   */
  @Prop({ required: false })
  @Field(() => Int, { nullable: true, description: 'Position of this line in the SOW billing source it was taken from.' })
  sourceIndex?: number;
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

  @Prop({ required: false, default: 0 })
  @Field(() => Float, { description: 'Sum of the service line items, BEFORE adjustments.' })
  subtotal: number;

  @Prop({ type: [{ type: mongoose.Schema.Types.Mixed }], default: [] })
  @Field(() => [InvoiceAdjustment], {
    description: 'SOW pricing adjustments carried onto this invoice, prorated to the services it covers.'
  })
  adjustments: InvoiceAdjustment[];

  @Prop({ required: true })
  @Field(() => Float, { description: 'Amount payable: subtotal plus the applied adjustments.' })
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

  /**
   * The SOW version these lines were taken from.
   *
   * `sourceIndex` only means something relative to a particular version: a
   * re-synced SOW can reorder its lines, so position 2 on one version is not
   * position 2 on another. Recording the version is what lets the double-billing
   * check know when two invoices are comparable and when they are merely
   * unproven. Nullable for invoices written before this existed, and for a
   * legacy SOW with no version in force at all.
   */
  @Prop({ required: false })
  @Field(() => Int, { nullable: true, description: 'Version number of the SOW these lines were billed from, when one was in force.' })
  sowVersionNumber?: number;

  /**
   * What could not be checked at generation time, in the reader's terms.
   *
   * An overlap this invoice can prove is refused outright. This is for the cases
   * it cannot prove — an earlier invoice that predates `sourceIndex`, or one
   * billed from a different SOW version — where staying silent would imply a
   * guarantee that was never made.
   */
  @Prop({ type: [String], required: false })
  @Field(() => [String], { nullable: true, description: 'Billing checks that could not be completed when this invoice was generated.' })
  billingWarnings?: string[];

  @Prop({ required: true, default: new Date() })
  @Field({ description: 'Date when the invoice record was created' })
  createdAt: Date;
}

export type InvoiceDocument = Invoice & Document;
export const InvoiceSchema = SchemaFactory.createForClass(Invoice);

InvoiceSchema.index({ jobId: 1, createdAt: -1 });
InvoiceSchema.index({ jobId: 1, invoiceNumber: 1 }, { unique: true });
