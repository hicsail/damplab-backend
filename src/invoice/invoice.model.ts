import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID, Float, Int } from '@nestjs/graphql';
import { Job } from '../job/job.model';
import { SOWAdjustmentType } from '../sow/sow.model';
import { PricingDetail } from '../pricing/pricing.model';
import { InvoiceKind } from './invoice-kind';
import { JobChargeKind } from '../job-payment/job-charge.model';

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

/**
 * One confirmed booking as an equipment invoice states it. A snapshot: the
 * booking may be moved or re-confirmed afterwards, and an issued statement must
 * keep saying what it said.
 */
@Schema({ _id: false })
@ObjectType({ description: 'One confirmed equipment booking as billed on an equipment invoice (snapshot at generation).' })
export class EquipmentInvoiceLine {
  @Prop({ required: true })
  @Field(() => ID, { description: 'The booking this line bills.' })
  bookingId: string;

  @Prop({ required: true })
  @Field({ description: 'Inventory item name, as snapshotted on the booking.' })
  itemName: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: "Label of the job's equipment-use operation, when the node is still resolvable." })
  operationLabel?: string;

  @Prop({ required: false })
  @Field({ nullable: true })
  startTime?: Date;

  @Prop({ required: false })
  @Field({ nullable: true })
  endTime?: Date;

  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'Confirmed hours used.' })
  actualHours?: number;

  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'The $/hour rate snapshot the booking carries.' })
  rate?: number;

  @Prop({ required: true })
  @Field(() => Float, { description: "The booking's stored cost. Never recomputed from hours x rate." })
  cost: number;

  @Prop({ required: false })
  @Field({ nullable: true })
  confirmedAt?: Date;
}

/**
 * A charge on the statement that is neither a SOW service line nor equipment
 * time: a deposit, or an ad-hoc cost or credit. A snapshot — voiding the
 * underlying charge changes the next statement, never an issued one.
 */
@Schema({ _id: false })
@ObjectType({ description: 'A custom or deposit charge as billed on a statement (snapshot at generation).' })
export class InvoiceCustomLine {
  @Prop({ required: true })
  @Field(() => ID, { description: 'The JobCharge this line bills.' })
  chargeId: string;

  @Prop({ required: true })
  @Field(() => JobChargeKind, { description: 'CUSTOM or DEPOSIT.' })
  kind: JobChargeKind;

  @Prop({ required: true })
  @Field()
  label: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Free text printed under the label in Other charges. Absent on lines billed without one.' })
  note?: string;

  @Prop({ required: true })
  @Field(() => Float, { description: 'Signed: a CUSTOM credit is negative.' })
  amount: number;
}

/**
 * The deposit as an invoice states it. Part of the invoice's total, never added
 * to it: it is the first slice of that total, asked for by its own due date.
 */
@Schema({ _id: false })
@ObjectType({ description: 'The deposit an invoice asks for, with its own due date (snapshot at issue). Part of the total, never added to it.' })
export class InvoiceDeposit {
  @Prop({ required: true })
  @Field(() => ID, { description: 'The DEPOSIT JobCharge this states.' })
  chargeId: string;

  @Prop({ required: true })
  @Field()
  label: string;

  @Prop({ required: true })
  @Field(() => Float)
  amount: number;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'When the deposit is due.' })
  dueDate?: Date;

  @Prop({ required: true })
  @Field(() => Float, { description: 'What was still owed against the deposit at issue: the deposit less payments, never below zero and never more than the balance due.' })
  outstanding: number;
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

  /**
   * Which version of the job's invoice this is — the same per-job count the
   * number's `-NNN` suffix carries. Absent on documents issued before versioning;
   * the `versionNumber` ResolveField reads those off that suffix.
   */
  @Prop({ required: false })
  versionNumber?: number;

  /**
   * What this invoice bills. Absent on every invoice written before equipment
   * invoicing existed, which is why nothing reads this field directly — see
   * `invoiceKindOf`, and the `kind` ResolveField that populates the wire.
   */
  @Prop({ required: false, type: String, enum: Object.values(InvoiceKind) })
  kind?: InvoiceKind;

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
  @Field(() => Float, {
    description:
      'What this invoice adds up before payments. On a SOW invoice the service lines before adjustments; on an EQUIPMENT or STATEMENT invoice the whole charge to date, adjustments and every other line already included.'
  })
  subtotal: number;

  @Prop({ type: [{ type: mongoose.Schema.Types.Mixed }], default: [] })
  @Field(() => [InvoiceAdjustment], {
    description: 'SOW pricing adjustments carried onto this invoice, prorated to the services it covers.'
  })
  adjustments: InvoiceAdjustment[];

  @Prop({ type: [{ type: mongoose.Schema.Types.Mixed }], default: [] })
  @Field(() => [EquipmentInvoiceLine], {
    description: 'Confirmed equipment bookings billed on this invoice. Populated on EQUIPMENT and STATEMENT invoices; empty on a SOW invoice.'
  })
  equipmentLines: EquipmentInvoiceLine[];

  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'Payments received against the job as at this invoice. EQUIPMENT and STATEMENT invoices.' })
  paymentsToDate?: number;

  @Prop({ required: false })
  @Field(() => Float, {
    nullable: true,
    description: 'chargesToDate minus paymentsToDate as at this invoice. Negative means a credit. EQUIPMENT and STATEMENT invoices.'
  })
  balanceDue?: number;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'When payment is due. Absent on documents written before due dates existed.' })
  dueDate?: Date;

  @Prop({ type: [{ type: mongoose.Schema.Types.Mixed }], default: [] })
  @Field(() => [InvoiceCustomLine], { description: 'Custom charges and discounts on this invoice. Empty on SOW and EQUIPMENT documents.' })
  customLines: InvoiceCustomLine[];

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  @Field(() => InvoiceDeposit, { nullable: true, description: 'The deposit this invoice asks for, when the job has one.' })
  deposit?: InvoiceDeposit;

  @Prop({ required: true })
  @Field(() => Float, {
    description: 'Amount payable now. On a STATEMENT, the balance due (charges to date minus payments to date). On older invoice kinds, the subtotal plus the applied adjustments.'
  })
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

  /**
   * Void, not delete. **Nothing may ever remove an invoice document**, and this is
   * load-bearing rather than tidiness: the invoice number is
   * `countDocuments({ jobId }) + 1` (see `InvoiceService.createForJob`), so
   * deleting one hands its number straight to the next invoice and produces two
   * `04217-003`s. A void leaves the count intact.
   *
   * Voiding changes nothing else: the job's charges and payments stay as they
   * are, and the next version restates them. Only the current invoice can be
   * voided — a superseded one is already not payable.
   *
   * All three fields move together. `voidedAt` is the flag every reader tests.
   */
  @Prop({ required: false })
  @Field({ nullable: true, description: 'When this invoice was voided. Absent on a live invoice.' })
  voidedAt?: Date;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Who voided it (username/email).' })
  voidedBy?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Why it was voided. Required when voiding.' })
  voidReason?: string;

  /**
   * Set on every earlier invoice when a newer version is issued: only one
   * invoice per job stands at a time. A superseded invoice is history, not
   * payable, and stays downloadable as the copy that was sent.
   */
  @Prop({ required: false })
  @Field({ nullable: true, description: 'When a newer version replaced this invoice. Absent on the current one.' })
  supersededAt?: Date;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'The invoice number of the version that replaced this one.' })
  supersededByNumber?: string;

  @Prop({ required: true, default: new Date() })
  @Field({ description: 'Date when the invoice record was created' })
  createdAt: Date;
}

export type InvoiceDocument = Invoice & Document;
export const InvoiceSchema = SchemaFactory.createForClass(Invoice);

InvoiceSchema.index({ jobId: 1, createdAt: -1 });
InvoiceSchema.index({ jobId: 1, invoiceNumber: 1 }, { unique: true });
