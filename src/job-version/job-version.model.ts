import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID, Int, Float, registerEnumType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';
import { JobState } from '../job/job.model';

/**
 * A job version is an immutable snapshot of a job's workflow graph. Every save
 * from the workflow editor inserts one; nothing is ever updated in place.
 *
 * Deliberately a *denormalized* snapshot rather than a clone of the live
 * Workflow/WorkflowNode documents. A WorkflowNode is not pure content — it
 * carries operational state (state, assigneeId, startedAt, completedSteps,
 * usedInventory, inventory reservations) that belongs to the lab, not to the
 * design. Cloning per version would fork bench progress and duplicate inventory
 * holds across versions. So the live documents stay the single source of
 * operational truth, and these snapshots exist purely to be diffed.
 */

export enum JobVersionAuthorRole {
  /** Written by the customer who owns the job. */
  CUSTOMER = 'CUSTOMER',
  /** Written by DAMP Lab staff. */
  STAFF = 'STAFF'
}
registerEnumType(JobVersionAuthorRole, { name: 'JobVersionAuthorRole' });

@Schema({ _id: false })
@ObjectType({ description: 'Canvas coordinates of a node at the time this version was written' })
export class JobVersionPosition {
  @Prop({ required: true })
  @Field(() => Float)
  x: number;

  @Prop({ required: true })
  @Field(() => Float)
  y: number;
}

@Schema({ _id: false })
@ObjectType({ description: 'One workflow node as frozen into this version' })
export class JobVersionNode {
  @Prop({ required: true })
  @Field(() => ID, {
    description:
      'The React Flow client-side node id, carried verbatim from submission through every edit. Diffing is keyed entirely on this — if it were ever regenerated, every node would read as deleted-and-re-added.'
  })
  id: string;

  @Prop({ required: true, default: '' })
  @Field({ defaultValue: '' })
  label: string;

  @Prop({ required: false })
  @Field(() => ID, { nullable: true, description: 'DampLabService this node ran' })
  serviceId?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Service name at the time of the snapshot, so the diff can label a node without a catalogue lookup' })
  serviceName?: string;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: [] })
  @Field(() => JSON, { description: 'Parameter values, canonical array shape: [{ id, value }]' })
  formData: any;

  @Prop({ required: true, default: '' })
  @Field({ defaultValue: '' })
  additionalInstructions: string;

  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'Node price as computed when this version was saved' })
  price?: number;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  @Field(() => JobVersionPosition, { nullable: true, description: 'Canvas position; absent on legacy jobs submitted before positions were read back' })
  position?: JobVersionPosition;
}

@Schema({ _id: false })
@ObjectType({ description: 'One workflow edge as frozen into this version' })
export class JobVersionEdge {
  @Prop({ required: true })
  @Field(() => ID)
  id: string;

  @Prop({ required: true })
  @Field(() => ID, { description: 'Client-side id of the source node (matches JobVersionNode.id)' })
  source: string;

  @Prop({ required: true })
  @Field(() => ID, { description: 'Client-side id of the target node (matches JobVersionNode.id)' })
  target: string;
}

@Schema({ _id: false })
@ObjectType({ description: 'One workflow (a connected tree on the canvas) as frozen into this version' })
export class JobVersionWorkflow {
  @Prop({ required: false })
  @Field(() => ID, { nullable: true, description: 'Live Workflow this snapshot came from; null for a tree first created by this edit' })
  workflowId?: string;

  @Prop({ required: true, default: '' })
  @Field({ defaultValue: '' })
  name: string;

  @Prop({ type: [mongoose.Schema.Types.Mixed], default: [] })
  @Field(() => [JobVersionNode])
  nodes: JobVersionNode[];

  @Prop({ type: [mongoose.Schema.Types.Mixed], default: [] })
  @Field(() => [JobVersionEdge])
  edges: JobVersionEdge[];
}

@Schema({ collection: 'job_versions', timestamps: true })
@ObjectType({ description: "Immutable snapshot of a job's workflow graph" })
export class JobVersion {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true })
  job: mongoose.Types.ObjectId;

  @Prop({ required: true })
  @Field(() => ID, { description: 'Parent job id (string mirror, for querying)' })
  jobId: string;

  @Prop({ required: true })
  @Field(() => Int, { description: 'Sortable, unique within a job. Starts at 1 (the original submission).' })
  versionNumber: number;

  @Prop({ required: true })
  @Field(() => JobVersionAuthorRole, {
    description: "Which side of the conversation wrote this version. The diff baseline is derived from it: baseline(N) is the newest version below N whose authorRole differs from N's."
  })
  authorRole: JobVersionAuthorRole;

  @Prop({ type: [mongoose.Schema.Types.Mixed], default: [] })
  @Field(() => [JobVersionWorkflow], { description: 'The whole graph, one entry per disconnected tree' })
  workflows: JobVersionWorkflow[];

  /**
   * Nullable by necessity, not by preference: versions written before this field
   * existed have none, and neither does the v1 backfilled for a job submitted
   * before versioning. The history UI shows the author chip alone in that case.
   */
  @Prop({ required: false })
  @Field(() => JobState, { nullable: true, description: "The job's state when this version was written. Absent on versions predating the field." })
  jobState?: JobState;

  /**
   * True for a version that records a state change rather than a graph edit. Its
   * workflows are a verbatim copy of its predecessor's, so it diffs empty by
   * construction — and must be skipped when choosing what to compare against, or
   * it would silently swallow the edit it followed.
   */
  @Prop({ default: false })
  @Field(() => Boolean, { nullable: true, defaultValue: false, description: 'True when this version records a state change rather than an edit to the graph.' })
  isEvent?: boolean;

  @Prop({ required: true, default: true })
  @Field(() => Boolean, {
    description:
      'False for unpublished staff drafts. Missing on legacy rows; treat as true so customers do not lose history.'
  })
  visibleToCustomer: boolean;

  /**
   * Optional on the way out — see jobState. `SaveJobWorkflowsInput` requires one
   * on the way in; the gap is the backfilled v1 and the canned event versions.
   */
  @Prop({ required: false })
  @Field({ nullable: true, description: 'Note describing what changed' })
  note?: string;

  @Prop({ required: true, default: '' })
  @Field({ defaultValue: '', description: 'Keycloak sub of the author' })
  createdBy: string;

  @Prop({ required: true, default: '' })
  @Field({ defaultValue: '', description: 'Display name of the author, resolved at write time' })
  createdByName: string;

  @Prop({ required: true, default: () => new Date() })
  @Field()
  createdAt: Date;
}

export type JobVersionDocument = JobVersion & Document;
export const JobVersionSchema = SchemaFactory.createForClass(JobVersion);

// One version number per job; also the index that serves history listing.
JobVersionSchema.index({ jobId: 1, versionNumber: -1 }, { unique: true });
