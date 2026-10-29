import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import mongoose, { Document } from 'mongoose';
import JSON from 'graphql-type-json';
import { HomologyScreeningStatus } from './job.model';

/**
 * One biosecurity screening of a job: every `JobScreeningService.screenJob` call writes exactly
 * one, covering both providers (biosecurity-update). The job's `homologyScreening` and
 * `aclidScreening` stay the "latest" summary the card reads; this is the history behind them.
 *
 * A collection of its own, not an array on the job: jobs are read whole on every page, and a
 * raw Aclid report per run would bloat each read. Read only through `ScreeningRunResolver`,
 * which is `jobs:view-all` + `showBiosecurity`.
 */
export enum ScreeningRunTrigger {
  /** Screening on submission (paused while AUTO_SCREENING_ENABLED is false), and the KYC path's on-demand screen. */
  SUBMISSION = 'SUBMISSION',
  /** Staff's "Rerun screening". */
  RERUN = 'RERUN'
}
registerEnumType(ScreeningRunTrigger, { name: 'ScreeningRunTrigger' });

@Schema({ _id: false })
@ObjectType({ description: 'One sequence a screening run sent to the providers' })
export class ScreeningRunSequence {
  @Prop({ type: String, required: true })
  @Field(() => String, { description: 'Slice name sent to the provider; the key of Aclid’s per-sequence details' })
  name: string;

  @Prop({ type: String, required: true })
  @Field(() => String, { description: '“<service> › <parameter> › row <n> › <column>”' })
  label: string;

  @Prop({ type: Number, required: true })
  @Field(() => Int)
  length: number;

  @Prop({ type: Boolean, required: true })
  @Field(() => Boolean, { description: 'Long enough for Aclid (30 bp)' })
  aclidEligible: boolean;
}
export const ScreeningRunSequenceSchema = SchemaFactory.createForClass(ScreeningRunSequence);

@Schema({ _id: false })
@ObjectType({ description: 'What Aclid said in one screening run' })
export class ScreeningRunAclidLeg {
  @Prop({ type: String, default: null })
  @Field(() => String, { nullable: true })
  screenId?: string | null;

  @Prop({ type: String, required: true, enum: HomologyScreeningStatus })
  @Field(() => HomologyScreeningStatus)
  homologyStatus: HomologyScreeningStatus;

  @Prop({ type: String, default: null })
  @Field(() => String, { nullable: true })
  status?: string | null;

  @Prop({ type: String, default: null })
  @Field(() => String, { nullable: true })
  regulatoryStatus?: string | null;

  @Prop({ type: String, default: null })
  @Field(() => String, { nullable: true })
  verificationStatus?: string | null;

  @Prop({ type: String, default: null })
  @Field(() => String, { nullable: true })
  decisionStatus?: string | null;

  @Prop({ type: Number, default: null })
  @Field(() => Int, { nullable: true })
  matchCount?: number | null;

  @Prop({ type: Number, default: null })
  @Field(() => Int, { nullable: true })
  materialCount?: number | null;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: null })
  @Field(() => JSON, { nullable: true })
  findings?: Record<string, unknown> | null;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: null })
  @Field(() => JSON, { nullable: true })
  materialSummary?: Record<string, unknown> | null;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: null })
  @Field(() => JSON, { nullable: true, description: 'GET /v2/screens/{id}/details: { [sequenceName]: MatchGroup }' })
  details?: Record<string, unknown> | null;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: null })
  @Field(() => JSON, { nullable: true, description: 'The full GET /v2/screens/{id} body' })
  raw?: Record<string, unknown> | null;

  @Prop({ type: String, default: null })
  @Field(() => String, { nullable: true })
  detail?: string | null;
}
export const ScreeningRunAclidLegSchema = SchemaFactory.createForClass(ScreeningRunAclidLeg);

@Schema({ _id: false })
@ObjectType({ description: 'What SecureDNA said in one screening run; the batch holds the hits' })
export class ScreeningRunSecureDnaLeg {
  @Prop({ type: String, default: null })
  @Field(() => ID, { nullable: true })
  batchId?: string | null;

  @Prop({ type: String, required: true, enum: HomologyScreeningStatus })
  @Field(() => HomologyScreeningStatus)
  status: HomologyScreeningStatus;

  @Prop({ type: String, default: null })
  @Field(() => String, { nullable: true })
  detail?: string | null;
}
export const ScreeningRunSecureDnaLegSchema = SchemaFactory.createForClass(ScreeningRunSecureDnaLeg);

@Schema({ collection: 'screening_runs', timestamps: true })
@ObjectType({ description: 'One biosecurity screening of a job, both providers. Staff with showBiosecurity only.' })
export class ScreeningRun {
  @Field(() => ID, { name: 'id' })
  _id: mongoose.Types.ObjectId;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true })
  @Field(() => ID)
  jobId: mongoose.Types.ObjectId | string;

  @Prop({ type: String, required: true, enum: ScreeningRunTrigger })
  @Field(() => ScreeningRunTrigger)
  trigger: ScreeningRunTrigger;

  @Prop({ type: String, default: null })
  @Field(() => String, { nullable: true, description: 'Display name of who asked; null for submission' })
  triggeredBy?: string | null;

  @Prop({ type: String, required: true, enum: HomologyScreeningStatus })
  @Field(() => HomologyScreeningStatus, { description: 'The rolled-up verdict, as written to the job’s homologyScreening' })
  status: HomologyScreeningStatus;

  @Prop({ type: Date, required: true })
  @Field(() => Date)
  startedAt: Date;

  @Prop({ type: Date, default: null })
  @Field(() => Date, { nullable: true })
  completedAt?: Date | null;

  @Prop({ type: Number, required: true, default: 0 })
  @Field(() => Int)
  sequenceCount: number;

  @Prop({ type: Number, required: true, default: 0 })
  @Field(() => Int, { description: 'Non-empty values not sent because they do not look like DNA' })
  skippedCount: number;

  @Prop({ type: String, default: null })
  @Field(() => String, { nullable: true })
  detail?: string | null;

  @Prop({ type: [ScreeningRunSequenceSchema], default: [] })
  @Field(() => [ScreeningRunSequence])
  sequences: ScreeningRunSequence[];

  @Prop({ type: ScreeningRunAclidLegSchema, default: null })
  @Field(() => ScreeningRunAclidLeg, { nullable: true })
  aclid?: ScreeningRunAclidLeg | null;

  @Prop({ type: ScreeningRunSecureDnaLegSchema, default: null })
  @Field(() => ScreeningRunSecureDnaLeg, { nullable: true })
  secureDna?: ScreeningRunSecureDnaLeg | null;
}

export type ScreeningRunDocument = ScreeningRun & Document;
export const ScreeningRunSchema = SchemaFactory.createForClass(ScreeningRun);
// History listing; and the refresh path's lookup by Aclid screen.
ScreeningRunSchema.index({ jobId: 1, startedAt: -1 });
ScreeningRunSchema.index({ 'aclid.screenId': 1 }, { sparse: true });
