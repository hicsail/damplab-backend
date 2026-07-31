import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID, registerEnumType } from '@nestjs/graphql';
import { Workflow } from '../workflow/models/workflow.model';

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
  CLOSED
}
registerEnumType(JobState, { name: 'JobState' });

export enum CustomerCategory {
  INTERNAL_CUSTOMERS = 'INTERNAL_CUSTOMERS',
  EXTERNAL_CUSTOMER_ACADEMIC = 'EXTERNAL_CUSTOMER_ACADEMIC',
  EXTERNAL_CUSTOMER_MARKET = 'EXTERNAL_CUSTOMER_MARKET',
  EXTERNAL_CUSTOMER_NO_SALARY = 'EXTERNAL_CUSTOMER_NO_SALARY'
}
registerEnumType(CustomerCategory, { name: 'CustomerCategory' });

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
    description: 'Customer category derived from Keycloak at job submission time. Used for category-specific pricing in downstream views.'
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
}

export type JobDocument = Job & Document;
export const JobSchema = SchemaFactory.createForClass(Job);

// Unique among jobs that have a display id; sparse so many legacy docs without jobId do not conflict.
JobSchema.index({ jobId: 1 }, { unique: true, sparse: true });
