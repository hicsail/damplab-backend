import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { JobReviewDecision } from './dto/review-job.input';
import { CustomerActionRequired, JobState } from './job.model';

export enum JobReviewCommandKind {
  REVIEW = 'REVIEW',
  RESPOND = 'RESPOND'
}

export enum JobReviewOperationStatus {
  PENDING = 'PENDING',
  APPLIED = 'APPLIED',
  FINALIZING = 'FINALIZING',
  COMPENSATING = 'COMPENSATING',
  COMPLETE = 'COMPLETE',
  COMPENSATED = 'COMPENSATED',
  CONFLICTED = 'CONFLICTED'
}

@Schema({ collection: 'job_review_operations', timestamps: true })
export class JobReviewOperation {
  @Prop({ type: String, required: true })
  operationId: string;

  @Prop({ type: String, required: true })
  jobId: string;

  @Prop({ type: String, required: true, enum: JobReviewCommandKind })
  commandKind: JobReviewCommandKind;

  @Prop({ type: String, required: true })
  payloadHash: string;

  @Prop({ type: String, required: true })
  actorSub: string;

  @Prop({ type: String, required: true })
  actorName: string;

  @Prop({ type: String, required: false, enum: JobReviewDecision })
  decision?: JobReviewDecision;

  @Prop({ type: String, required: false, enum: CustomerActionRequired })
  responseAction?: CustomerActionRequired;

  @Prop({ type: String, required: false })
  normalizedMessage?: string;

  @Prop({ type: Number, required: true, enum: JobState })
  originalState: JobState;

  @Prop({ type: String, required: false, enum: CustomerActionRequired })
  originalCustomerActionRequired?: CustomerActionRequired | null;

  @Prop({ type: Boolean, required: true })
  originalCustomerEditingEnabled: boolean;

  @Prop({ type: Number, required: false })
  originalAcceptedJobVersionNumber?: number | null;

  @Prop({ type: String, required: false })
  originalAcceptedContractFingerprint?: string | null;

  @Prop({ type: String, required: false })
  originalAcceptedBillingFingerprint?: string | null;

  @Prop({ type: Date, required: false })
  originalAcceptedAt?: Date | null;

  @Prop({ type: String, required: false })
  originalAcceptedBy?: string | null;

  @Prop({ type: String, required: false })
  originalReviewOperationId?: string | null;

  @Prop({ type: Number, required: false })
  selectedAcceptedVersionNumber?: number;

  @Prop({ type: String, required: false })
  selectedContractFingerprint?: string;

  @Prop({ type: String, required: false })
  selectedBillingFingerprint?: string;

  @Prop({ type: String, required: true, enum: JobReviewOperationStatus, default: JobReviewOperationStatus.PENDING })
  status: JobReviewOperationStatus;

  @Prop({ type: Date, required: false })
  jobWrittenAt?: Date;

  @Prop({ type: Date, required: false })
  historyWrittenAt?: Date;

  @Prop({ type: Date, required: false })
  publishedAt?: Date;

  @Prop({ type: Date, required: false })
  commentWrittenAt?: Date;

  @Prop({ type: Date, required: false })
  activityWrittenAt?: Date;

  @Prop({ type: Date, required: false })
  completedAt?: Date;

  @Prop({ type: Date, required: false })
  compensatedAt?: Date;
}

export type JobReviewOperationDocument = JobReviewOperation & Document;
export const JobReviewOperationSchema = SchemaFactory.createForClass(JobReviewOperation);

JobReviewOperationSchema.index({ operationId: 1 }, { unique: true });
