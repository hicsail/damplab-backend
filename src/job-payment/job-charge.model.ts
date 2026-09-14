import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Field, Float, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

/**
 * What a job charge is.
 *
 * `CUSTOM` is a free-text line staff add by hand (a courier fee, or a discount —
 * may be negative). `DEPOSIT` is money asked for up front, by its own due date:
 * it is the first slice of the invoice total, never added to it, and at most one
 * stands per job. `SERVICE_LINE` is legacy — the retired release-by-line
 * invoicing wrote it, and nothing reads or writes it now; it stays in the enum
 * so those rows still load.
 */
export enum JobChargeKind {
  SERVICE_LINE = 'SERVICE_LINE',
  CUSTOM = 'CUSTOM',
  DEPOSIT = 'DEPOSIT'
}

registerEnumType(JobChargeKind, { name: 'JobChargeKind', description: 'What a job charge is.' });

/**
 * The charges a job carries beyond its Statement of Work and its bookings:
 * custom lines and the deposit, as one append-only record the job's invoice
 * restates on every version.
 *
 * A ledger of its own rather than a field on the Job document, because the
 * job document is versioned and restorable — a billing ledger must never roll
 * back with it. A charge that turns out to be wrong is voided, never deleted,
 * so the invoice history can always explain why the total moved.
 */
@Schema({ collection: 'jobcharges' })
@ObjectType({ description: 'A charge against a job. Voided charges are kept and excluded from the balance.' })
export class JobCharge {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ required: true, index: true })
  @Field(() => ID, { description: "The job's Mongo _id as a string, matching Booking.jobId and SOW.jobId." })
  jobId: string;

  @Prop({ required: true, type: String, enum: Object.values(JobChargeKind) })
  @Field(() => JobChargeKind, { description: 'What kind of charge this is.' })
  kind: JobChargeKind;

  @Prop({ required: true })
  @Field({ description: 'What the charge is for, shown on the invoice.' })
  label: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Free text shown under the label on the invoice. Absent on charges added without one.' })
  note?: string;

  @Prop({ required: true })
  @Field(() => Float, { description: 'Amount of the charge. CUSTOM may be negative (a discount); DEPOSIT must be positive.' })
  amount: number;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'When a DEPOSIT is due. Set only on DEPOSIT charges.' })
  dueDate?: Date;

  @Prop({ required: false })
  @Field(() => ID, { nullable: true, description: 'Legacy: the SOW service a SERVICE_LINE charge was released from.' })
  serviceId?: string;

  @Prop({ required: false })
  @Field(() => Int, { nullable: true, description: 'Legacy: the SOW version a SERVICE_LINE charge was released at.' })
  sowVersionNumber?: number;

  @Prop({ required: false })
  @Field(() => Int, { nullable: true, description: "Legacy: a SERVICE_LINE charge's position within the SOW's billable services." })
  sourceIndex?: number;

  @Prop({ required: true })
  @Field({ description: 'Who added it (username/email).' })
  addedBy: string;

  @Prop({ required: true })
  @Field({ description: 'When it was added.' })
  addedAt: Date;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'When this charge was voided. Absent on a live charge.' })
  voidedAt?: Date;

  @Prop({ required: false })
  @Field({ nullable: true })
  voidedBy?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Why it was voided. Required when voiding.' })
  voidReason?: string;
}

export type JobChargeDocument = JobCharge & Document;
export const JobChargeSchema = SchemaFactory.createForClass(JobCharge);

JobChargeSchema.index({ jobId: 1, addedAt: -1 });
