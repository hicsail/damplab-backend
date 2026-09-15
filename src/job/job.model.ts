import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID, Int, registerEnumType } from '@nestjs/graphql';
import { Workflow } from '../workflow/models/workflow.model';
import { CustomerCategory } from '../pricing/customer-category';

export enum JobState {
  CREATING,
  SUBMITTED,
  CHANGES_REQUESTED,
  ACCEPTED,
  WAITING_FOR_SOW,
  QUEUED,
  IN_PROGRESS,
  COMPLETE,
  REJECTED,
  /**
   * Terminal "closed-out" state set by staff when work and billing are
   * fully wrapped up. Closed jobs are explicitly excluded from the lab
   * monitor and similar live boards (see getWorkflowIdsForApprovedJobs).
   */
  CLOSED,
  /**
   * Terminal state the *client* puts a job in when they decide not to proceed.
   *
   * Distinct from REJECTED, which reads as the lab declining the request, and
   * from CLOSED, which is the lab wrapping up completed work. Appended rather
   * than inserted: JobState is persisted as an ordinal, so renumbering an
   * existing member would silently relabel every stored job.
   */
  CANCELLED
}
registerEnumType(JobState, { name: 'JobState' });

// Defined in src/pricing/customer-category.ts so the framework-free pricing
// utilities can share the one definition; registered for GraphQL here.
export { CustomerCategory };
registerEnumType(CustomerCategory, { name: 'CustomerCategory' });

export enum CustomerActionRequired {
  REPLY = 'REPLY',
  EDIT_WORKFLOW = 'EDIT_WORKFLOW',
  APPROVE_WORKFLOW = 'APPROVE_WORKFLOW'
}
registerEnumType(CustomerActionRequired, { name: 'CustomerActionRequired' });

/**
 * Homology screening verdict for a job, from SecureDNA.
 *
 * Four states because the Biosecurity card has four icons, and the distinction
 * that matters is between a sequence that failed and a screen that never
 * happened: `FAILED` means SecureDNA denied synthesis, `UNAVAILABLE` means we
 * could not get an answer (no screenable sequences, SecureDNA unreachable, or a
 * job submitted before screening existed).
 */
export enum HomologyScreeningStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  UNAVAILABLE = 'UNAVAILABLE'
}
registerEnumType(HomologyScreeningStatus, { name: 'HomologyScreeningStatus' });

@ObjectType({ description: 'SecureDNA homology screening state for the job page Biosecurity card' })
export class HomologyScreening {
  @Field(() => HomologyScreeningStatus)
  status: HomologyScreeningStatus;

  @Field(() => Date, { description: 'When the screening run was dispatched' })
  startedAt: Date;

  @Field(() => Date, { nullable: true, description: 'When a verdict was recorded; null while in progress' })
  completedAt?: Date | null;

  @Field(() => ID, { nullable: true, description: 'Stored ScreeningBatch holding the hazard hits and diagnostics' })
  batchId?: string | null;

  @Field(() => Int, { description: 'How many sequences were sent to SecureDNA' })
  sequenceCount: number;

  @Field(() => String, { nullable: true, description: 'Why, in one line, for a status that is not PASSED' })
  detail?: string | null;
}

@ObjectType({ description: 'Aclid sequence screen and KYC state for the Biosecurity card' })
export class AclidScreening {
  @Field(() => String, { nullable: true })
  screenId?: string | null;

  @Field(() => HomologyScreeningStatus)
  homologyStatus: HomologyScreeningStatus;

  @Field(() => String, { nullable: true })
  regulatoryStatus?: string | null;

  @Field(() => String, { nullable: true })
  verificationStatus?: string | null;

  @Field(() => String, { nullable: true })
  decisionStatus?: string | null;

  @Field(() => Date, { nullable: true })
  verificationCompletedAt?: Date | null;

  @Field(() => Int)
  sequenceCount: number;

  @Field(() => Date)
  startedAt: Date;

  @Field(() => Date, { nullable: true })
  completedAt?: Date | null;

  @Field(() => String, { nullable: true })
  detail?: string | null;

  @Field(() => HomologyScreeningStatus)
  customerStatus: HomologyScreeningStatus;
}

@ObjectType({ description: 'File attached to a job for additional context or requirements' })
export class JobAttachment {
  @Field({ description: 'Original filename of the uploaded document', nullable: true })
  filename?: string;

  @Field({ description: 'S3 object key where the document is stored' })
  key: string;

  @Field({ description: 'MIME type of the uploaded file' })
  contentType: string;

  @Field({ description: 'Size of the file in bytes' })
  size: number;

  @Field({ description: 'When this attachment was recorded', nullable: true })
  uploadedAt?: Date;

  @Field({ description: 'Temporary URL to download this attachment', nullable: true })
  url?: string;
}

@Schema()
@ObjectType({ description: 'Jobs encapsulate many workflows that were submitted together' })
export class Job {
  @Field(() => ID, { name: 'id' })
  _id: string;

  /** Assigned on create for new jobs; omitted on legacy jobs submitted before this field existed. */
  @Prop({ required: false })
  @Field({
    description: 'Customer-facing job identifier (5-digit numeric string). Null for legacy jobs.',
    nullable: true
  })
  jobId?: string;

  @Prop()
  @Field({ description: 'Human readable name of the workflow' })
  name: string;

  /// These fields will be replaced by a user field in the future /////////////
  // ^ Should there be a single 'user' field with a nested object, or was the point more about 'real auth'?
  @Prop()
  @Field({ description: 'Username of the person who submitted the job - from access token' })
  username: string;

  @Prop({ required: false })
  @Field({
    description: 'Display name for the client (captured at checkout). Used for customer-facing documents like SOWs.',
    nullable: true
  })
  clientDisplayName?: string;

  @Prop({ required: false })
  @Field({
    description: 'Email of the actual client when a staff member submits on their behalf.',
    nullable: true
  })
  clientEmail?: string;

  @Prop()
  @Field({ description: 'Subject id of the user - from access token' })
  sub: string;

  @Prop()
  @Field({ description: 'The email address of the user - from access token' })
  email: string;

  @Prop()
  @Field({ description: 'The institute the user is from' }) // This is not in the keycloak tokens, so is supplied by the user.
  institute: string;
  /////////////////////////////////////////////////////////////////////////////

  @Prop({ required: false })
  @Field(() => CustomerCategory, {
    nullable: true,
    description: 'Customer pricing category for this job. Set from Keycloak at submission; staff may update it (and the owner account / other jobs) via changeJobCustomerCategory.'
  })
  customerCategory?: CustomerCategory;

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: Workflow.name }] })
  @Field(() => [Workflow], { description: 'The workflows that were submitted together' })
  workflows: mongoose.Types.ObjectId[];

  @Prop({ default: Date.now })
  @Field({ description: 'The date the job was submitted' })
  submitted: Date;

  @Prop({ required: false })
  @Field({ description: 'Additional information the user provided', nullable: true })
  notes?: string;

  @Prop({ required: true, default: JobState.CREATING })
  @Field(() => JobState, { description: 'Where in the Job life cycle this Job is' })
  state: JobState;

  @Prop({ type: String, required: false, enum: CustomerActionRequired })
  @Field(() => CustomerActionRequired, {
    nullable: true,
    description: 'The explicit action the customer must complete while this job is in CHANGES_REQUESTED.'
  })
  customerActionRequired?: CustomerActionRequired | null;

  /** Identifies which journaled review operation owns the current authoritative state, including compensation checks. */
  @Prop({ type: String, required: false })
  lastReviewOperationId?: string;

  @Prop({ type: Number, required: false })
  @Field(() => Int, {
    nullable: true,
    description: 'The content version in force when the job was last handed to the customer — what withdrawing it restores.'
  })
  handoverVersionNumber?: number | null;

  @Prop({ type: Number, required: false })
  @Field(() => Int, {
    nullable: true,
    description: 'Exact immutable job-version number accepted by staff.'
  })
  acceptedJobVersionNumber?: number | null;

  /**
   * The job's billing figures as they stood when staff accepted it — see
   * SowVersionService.jobBillingFingerprint.
   *
   * A SOW may only be sent to the customer while this still matches the job's
   * current figures. Editing the spec afterwards therefore re-locks the send
   * until staff re-accept, which is what stops a price the customer never agreed
   * to from reaching them. Absent on jobs accepted before this existed, which
   * read as "never accepted" and need one re-accept to unlock.
   */
  @Prop({ required: false })
  @Field({ description: 'Billing fingerprint of the job spec at the moment staff accepted it.', nullable: true })
  acceptedBillingFingerprint?: string;

  @Prop({ required: false })
  @Field({ description: 'When staff last accepted this job as specified', nullable: true })
  acceptedAt?: Date;

  @Prop({ required: false })
  @Field({ description: 'Keycloak sub of the staff member who last accepted this job', nullable: true })
  acceptedBy?: string;

  /**
   * When the client last asked for edit access, or absent when no request is
   * outstanding.
   *
   * The request grants nothing on its own — staff open the canvas the way they
   * always have, with reviewJob(REQUEST_EDITS). This only records that an ask is
   * pending, so the client's button can say so instead of inviting a second
   * click, and so staff can see it on the job. Any review decision clears it.
   */
  @Prop({ required: false })
  @Field({ description: 'When the client last requested edit access on this job. Cleared by the next staff review decision.', nullable: true })
  editAccessRequestedAt?: Date;

  @Prop({
    type: [
      {
        filename: String,
        key: String,
        contentType: String,
        size: Number,
        uploadedAt: Date
      }
    ],
    default: []
  })
  @Field(() => [JobAttachment], {
    description: 'Supporting documents uploaded by the customer for this job',
    nullable: 'itemsAndList'
  })
  attachments?: JobAttachment[];

  /**
   * Latest homology screening run. Written to IN_PROGRESS before SecureDNA is
   * called, so the card never has to infer "running" from an absent field —
   * absent means a job that predates screening, which reads UNAVAILABLE.
   */
  @Prop({ type: Object, required: false })
  @Field(() => HomologyScreening, { nullable: true })
  homologyScreening?: HomologyScreening;

  @Prop({ type: Object, required: false })
  @Field(() => AclidScreening, { nullable: true })
  aclidScreening?: AclidScreening;

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ScreeningBatch' }], default: [] })
  @Field(() => [ID], {
    nullable: 'itemsAndList',
    description: 'Every SecureDNA screening batch run for this job, oldest first.'
  })
  screeningBatchIds?: string[];

  /**
   * Archived jobs are hidden from the default jobs dashboard and from the live
   * lab boards, but are never deleted and stay fully resolvable.
   *
   * Deliberately a flag rather than a JobState value: archiving is orthogonal to
   * lifecycle position (staff may archive a job that is IN_PROGRESS), and the
   * original state must survive so it is clear what was shelved. Adding an enum
   * member would also have meant auditing every state-machine branch.
   */
  @Prop({ required: false, default: false, index: true })
  @Field(() => Boolean, { nullable: true, defaultValue: false, description: 'Archived: hidden from the default dashboard and live boards, but retained.' })
  isArchived?: boolean;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'When the job was archived.' })
  archivedAt?: Date;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Who archived it (username/email).' })
  archivedBy?: string;

  @Prop({ required: false })
  @Field(() => JobState, {
    nullable: true,
    description: 'The state the job was in when archived — kept as an audit trail, since staff may archive work that was still in progress.'
  })
  archivedFromState?: JobState;

  /**
   * The lab's pause on equipment booking for this job.
   *
   * A flag rather than a JobState value, for the same reason `isArchived` is one:
   * pausing is orthogonal to where the job sits in its lifecycle, and it must be
   * reversible without disturbing that. Existing bookings are never touched — this
   * only stops new ones being made and existing ones being moved.
   */
  @Prop({ required: false, default: false })
  @Field(() => Boolean, { nullable: true, defaultValue: false, description: 'Whether the lab has paused equipment booking on this job.' })
  bookingBlocked?: boolean;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Why booking is paused. Shown to the customer verbatim.' })
  bookingBlockedReason?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Who last changed the booking pause (username/email).' })
  bookingBlockedBy?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'When the booking pause was last changed.' })
  bookingBlockedAt?: Date;
}

export type JobDocument = Job & Document;
export const JobSchema = SchemaFactory.createForClass(Job);

// Unique among jobs that have a display id; sparse so many legacy docs without jobId do not conflict.
JobSchema.index({ jobId: 1 }, { unique: true, sparse: true });
