import { Field, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Typed vocabulary for activity events. Values are plain strings that match
 * what is already stored in MongoDB, so no data migration is needed.
 */
export enum ActivityEventType {
  // Job lifecycle
  JOB_SUBMITTED = 'JOB_SUBMITTED',
  JOB_REVIEWED = 'JOB_REVIEWED',
  JOB_REVIEW_RESPONSE = 'JOB_REVIEW_RESPONSE',
  JOB_WITHDRAWN_FROM_CUSTOMER = 'JOB_WITHDRAWN_FROM_CUSTOMER',
  JOB_ACCEPTANCE_WITHDRAWN = 'JOB_ACCEPTANCE_WITHDRAWN',
  JOB_STATE_CHANGED = 'JOB_STATE_CHANGED',
  JOB_ARCHIVED = 'JOB_ARCHIVED',
  JOB_UNARCHIVED = 'JOB_UNARCHIVED',
  JOB_UPDATED = 'JOB_UPDATED',
  JOB_WORKFLOWS_EDITED = 'JOB_WORKFLOWS_EDITED',
  JOB_CUSTOMER_CATEGORY_CHANGED = 'JOB_CUSTOMER_CATEGORY_CHANGED',
  JOB_BOOKING_BLOCKED = 'JOB_BOOKING_BLOCKED',
  JOB_BOOKING_UNBLOCKED = 'JOB_BOOKING_UNBLOCKED',
  JOB_REJECTED = 'JOB_REJECTED',
  JOB_EDIT_ACCESS_REQUESTED = 'JOB_EDIT_ACCESS_REQUESTED',
  JOB_CANCELLED = 'JOB_CANCELLED',
  JOB_CLOSED = 'JOB_CLOSED',

  // Workflow & node
  WORKFLOW_STATE_CHANGED = 'WORKFLOW_STATE_CHANGED',
  LAB_NODE_STATE_CHANGED = 'LAB_NODE_STATE_CHANGED',
  LAB_NODE_ASSIGNED = 'LAB_NODE_ASSIGNED',
  LAB_NODE_INVENTORY_SET = 'LAB_NODE_INVENTORY_SET',
  LAB_NODE_ESTIMATE_UPDATED = 'LAB_NODE_ESTIMATE_UPDATED',
  LAB_NODE_ARCHIVED = 'LAB_NODE_ARCHIVED',
  LAB_NODE_UNARCHIVED = 'LAB_NODE_UNARCHIVED',

  // SOW
  SOW_CREATED = 'SOW_CREATED',
  SOW_UPDATED = 'SOW_UPDATED',
  SOW_SENT = 'SOW_SENT',
  SOW_SIGNED = 'SOW_SIGNED',
  SOW_FINALIZED = 'SOW_FINALIZED',
  SOW_CANCELLED = 'SOW_CANCELLED',

  // Invoice
  INVOICE_GENERATED = 'INVOICE_GENERATED',
  INVOICE_VOIDED = 'INVOICE_VOIDED',
  INVOICE_SUPERSEDED = 'INVOICE_SUPERSEDED',
  INVOICE_PAYMENT_RECORDED = 'INVOICE_PAYMENT_RECORDED',

  // Comments
  COMMENT_CREATED = 'COMMENT_CREATED',
  COMMENT_UPDATED = 'COMMENT_UPDATED',
  COMMENT_DELETED = 'COMMENT_DELETED'
}
registerEnumType(ActivityEventType, { name: 'ActivityEventType' });

@Schema({ collection: 'activity_events' })
export class ActivityEventEntity {
  @Prop({ type: Date, required: true, default: () => new Date() })
  createdAt: Date;

  @Prop({ type: String, required: true })
  type: string;

  @Prop({ type: String, required: true })
  message: string;

  @Prop({ type: String, required: false })
  actorDisplayName?: string;

  // ── Job reference ──
  @Prop({ type: String, required: false })
  jobId?: string;

  // ── Job version reference (links to job_versions) ──
  @Prop({ type: Number, required: false })
  jobVersionNumber?: number;

  // ── SOW references (links to sow / sow_versions) ──
  @Prop({ type: String, required: false })
  sowId?: string;

  @Prop({ type: Number, required: false })
  sowVersionNumber?: number;

  // ── Invoice references (links to invoices) ──
  @Prop({ type: String, required: false })
  invoiceId?: string;

  @Prop({ type: String, required: false })
  invoiceNumber?: string;

  // ── Comment reference (links to comments) ──
  @Prop({ type: String, required: false })
  commentId?: string;

  // ── Workflow / node references ──
  @Prop({ type: String, required: false })
  workflowId?: string;

  @Prop({ type: String, required: false })
  workflowNodeId?: string;

  @Prop({ type: String, required: false })
  serviceName?: string;

  // ── Idempotency ──
  @Prop({ type: String, required: false })
  operationId?: string;
}

export type ActivityEventEntityDocument = ActivityEventEntity & Document;
export const ActivityEventEntitySchema = SchemaFactory.createForClass(ActivityEventEntity);

ActivityEventEntitySchema.index({ createdAt: -1 });
ActivityEventEntitySchema.index({ type: 1, createdAt: -1 });
ActivityEventEntitySchema.index({ jobId: 1, createdAt: -1 });
ActivityEventEntitySchema.index({ invoiceId: 1, createdAt: -1 });
ActivityEventEntitySchema.index(
  { operationId: 1 },
  {
    unique: true,
    partialFilterExpression: { operationId: { $type: 'string' } }
  }
);

@ObjectType()
export class ActivityEvent {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => ActivityEventType)
  type: string;

  @Field(() => String)
  message: string;

  @Field(() => String, { nullable: true })
  actorDisplayName?: string | null;

  @Field(() => String, { nullable: true })
  jobId?: string | null;

  @Field(() => Int, { nullable: true, description: 'Links to a job version for navigation' })
  jobVersionNumber?: number | null;

  @Field(() => String, { nullable: true })
  sowId?: string | null;

  @Field(() => Int, { nullable: true, description: 'Links to a SOW version for navigation' })
  sowVersionNumber?: number | null;

  @Field(() => String, { nullable: true })
  invoiceId?: string | null;

  @Field(() => String, { nullable: true })
  invoiceNumber?: string | null;

  @Field(() => String, { nullable: true })
  commentId?: string | null;

  @Field(() => String, { nullable: true })
  workflowId?: string | null;

  @Field(() => String, { nullable: true })
  workflowNodeId?: string | null;

  @Field(() => String, { nullable: true })
  serviceName?: string | null;
}
