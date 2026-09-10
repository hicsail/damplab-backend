import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Field, Float, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

/**
 * What a job charge is.
 *
 * `SERVICE_LINE` is written only by invoice generation, releasing one SOW
 * position at the cost that stood when it was released — see `JobChargeService`.
 * `CUSTOM` is a free-text line staff add by hand (a courier fee, a discount —
 * may be negative). `DEPOSIT` is money owed up front, before any service line
 * has been released.
 */
export enum JobChargeKind {
  SERVICE_LINE = 'SERVICE_LINE',
  CUSTOM = 'CUSTOM',
  DEPOSIT = 'DEPOSIT'
}

registerEnumType(JobChargeKind, { name: 'JobChargeKind', description: 'What a job charge is.' });

/**
 * The whole charge ledger for a job: released SOW service lines, prorated
 * adjustments, confirmed equipment usage, custom lines and deposits, all as
 * one append-only record.
 *
 * A ledger of its own rather than a field on the Job document, because the
 * job document is versioned and restorable — a billing ledger must never roll
 * back with it. A charge that turns out to be wrong is voided, never deleted,
 * so the running statement can always explain why the balance moved.
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
  @Field({ description: 'What the charge is for, shown on the statement.' })
  label: string;

  @Prop({ required: true })
  @Field(() => Float, { description: 'Amount of the charge. CUSTOM may be negative; SERVICE_LINE and DEPOSIT must be positive.' })
  amount: number;

  @Prop({ required: false })
  @Field(() => ID, { nullable: true, description: 'The SOW service this line was released from. Set only on SERVICE_LINE charges.' })
  serviceId?: string;

  @Prop({ required: false })
  @Field(() => Int, { nullable: true, description: "The SOW version's versionNumber this line was released at, kept for provenance only. Set only on SERVICE_LINE charges." })
  sowVersionNumber?: number;

  @Prop({ required: false })
  @Field(() => Int, {
    nullable: true,
    description:
      "The line's position within the SOW's billable services. The release ledger is keyed on this, within the job, not on the version — a released line keeps the amount it was released at forever. Set only on SERVICE_LINE charges."
  })
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
