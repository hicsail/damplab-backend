import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID, Int, registerEnumType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';
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
  REJECTED
}
registerEnumType(JobState, { name: 'JobState' });

export enum CustomerCategory {
  INTERNAL_CUSTOMERS = 'INTERNAL_CUSTOMERS',
  EXTERNAL_CUSTOMER_ACADEMIC = 'EXTERNAL_CUSTOMER_ACADEMIC',
  EXTERNAL_CUSTOMER_MARKET = 'EXTERNAL_CUSTOMER_MARKET',
  EXTERNAL_CUSTOMER_NO_SALARY = 'EXTERNAL_CUSTOMER_NO_SALARY'
}
registerEnumType(CustomerCategory, { name: 'CustomerCategory' });

@ObjectType({ description: 'SecureDNA screening state for job approval / SOW UI gating' })
export class JobScreeningStatus {
  @Field(() => Boolean, { description: 'True when this job has at least one gibson-assembly insert or m-cloning vector/insert sequence to screen' })
  requiresScreening: boolean;

  @Field(() => Int, { description: 'Count of DNA sequences that would be included in a screening batch' })
  targetSequenceCount: number;

  @Field(() => Boolean)
  hasScreeningBatch: boolean;

  @Field(() => Boolean, { description: 'True when the latest batch matches current job sequences (names and content)' })
  sequencesCurrent: boolean;

  @Field(() => Boolean, { description: 'True when the latest batch granted synthesis and reported no errors' })
  screeningPassed: boolean;

  @Field(() => Boolean, { description: 'When true, staff may generate a SOW and accept the job (per screening rules)' })
  allowStaffActions: boolean;

  @Field(() => String, { nullable: true, description: 'Explains why actions are blocked, for UI' })
  blockingMessage: string | null;
}

@ObjectType({ description: 'One sequence slice from the latest SecureDNA batch (for job tracking UI)' })
export class JobScreeningSliceResult {
  @Field(() => String, { description: 'Full MPI slice name: <workflowId>_<nodeId>_<fieldId>' })
  sliceName: string;

  @Field(() => String)
  workflowId: string;

  @Field(() => String, { description: 'Workflow node graph id (React Flow id)' })
  nodeId: string;

  @Field(() => String, { description: 'Parameter id, e.g. insert or vector' })
  fieldId: string;

  @Field(() => Int)
  order: number;

  @Field(() => String, { nullable: true })
  originalSeq?: string | null;

  @Field(() => JSON, { description: 'SecureDNA hazard hits for this slice' })
  threats: unknown[];

  @Field(() => String, { nullable: true })
  warning?: string | null;
}

@ObjectType({ description: 'Latest screening batch on this job for staff UI (null if none)' })
export class JobScreeningBatchDisplay {
  @Field(() => ID)
  batchId: string;

  @Field(() => String, { description: 'MPI batch synthesis permission: granted | denied' })
  synthesisPermission: string;

  @Field(() => Date)
  mpiCreatedAt: Date;

  @Field(() => Date, { description: 'When this batch was stored in DAMPLab' })
  screenedAt: Date;

  @Field(() => Boolean, { description: 'Whether batch sequences still match current job form data' })
  sequencesCurrent: boolean;

  @Field(() => Int)
  batchErrorCount: number;

  @Field(() => Int)
  batchWarningCount: number;

  @Field(() => [JobScreeningSliceResult])
  slices: JobScreeningSliceResult[];
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

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ScreeningBatch' }], default: [] })
  @Field(() => [ID], {
    nullable: 'itemsAndList',
    description: 'MPI SecureDNA screening batches run for this job (append-only; multiple runs over time)'
  })
  screeningBatchIds?: string[];
}

export type JobDocument = Job & Document;
export const JobSchema = SchemaFactory.createForClass(Job);

// Unique among jobs that have a display id; sparse so many legacy docs without jobId do not conflict.
JobSchema.index({ jobId: 1 }, { unique: true, sparse: true });
