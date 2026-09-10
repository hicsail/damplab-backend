import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Field, Float, ID, ObjectType } from '@nestjs/graphql';

/**
 * Money the lab has received against a job.
 *
 * A ledger of its own rather than a field on the Job document, because the job
 * document is versioned and restorable — a payment must never roll back with a
 * restored workflow. Free text rather than a method enum: "Check #1042" is what
 * the lab writes today, and there is nothing to maintain when SAP/Ariba arrives.
 *
 * Void, never delete: a payment that turned out not to have cleared is struck
 * through on the job page with its reason, so the running statement can explain
 * why the balance moved back up.
 */
@Schema({ collection: 'jobpayments' })
@ObjectType({ description: 'A payment received against a job. Voided payments are kept and excluded from the balance.' })
export class JobPayment {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ required: true, index: true })
  @Field(() => ID, { description: "The job's Mongo _id as a string, matching Booking.jobId and SOW.jobId." })
  jobId: string;

  @Prop({ required: true })
  @Field(() => Float, { description: 'Amount received, greater than zero.' })
  amount: number;

  @Prop({ required: true })
  @Field({ description: 'The date the lab received the money — not the date it was entered.' })
  receivedOn: Date;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Free text: a cheque number, a PO, an ISR reference.' })
  reference?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Free-text note.' })
  note?: string;

  @Prop({ required: true })
  @Field({ description: 'Who recorded it (username/email).' })
  recordedBy: string;

  @Prop({ required: true })
  @Field({ description: 'When it was recorded.' })
  recordedAt: Date;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'When this payment was voided. Absent on a live payment.' })
  voidedAt?: Date;

  @Prop({ required: false })
  @Field({ nullable: true })
  voidedBy?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Why it was voided. Required when voiding.' })
  voidReason?: string;
}

export type JobPaymentDocument = JobPayment & Document;
export const JobPaymentSchema = SchemaFactory.createForClass(JobPayment);

JobPaymentSchema.index({ jobId: 1, receivedOn: -1 });
