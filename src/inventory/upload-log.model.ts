import { ObjectType, Field, ID, Int, InputType } from '@nestjs/graphql';
import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import JSON from 'graphql-type-json';

/** A before/after snapshot for one item affected by an upload. */
@ObjectType({ description: 'Before/after snapshot of a single inventory item affected by an upload.' })
export class FieldSnapshot {
  @Field(() => ID, { description: 'The inventory item id.' })
  itemId: string;

  @Field({ description: 'What happened: CREATE, UPDATE, REACTIVATE, or SKIP.' })
  action: string;

  @Field(() => JSON, { nullable: true, description: 'Field values before the change (null for creates).' })
  before?: Record<string, unknown>;

  @Field(() => JSON, { nullable: true, description: 'Field values after the change.' })
  after?: Record<string, unknown>;
}

@InputType()
export class FieldSnapshotInput {
  @Field(() => ID)
  itemId: string;

  @Field()
  action: string;

  @Field(() => JSON, { nullable: true })
  before?: Record<string, unknown>;

  @Field(() => JSON, { nullable: true })
  after?: Record<string, unknown>;
}

const FieldSnapshotSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    action: { type: String, required: true },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed }
  },
  { _id: false }
);

/** An audit log entry for a bulk inventory upload. */
@Schema({ timestamps: true })
@ObjectType({ description: 'Audit log for a bulk inventory upload.' })
export class UploadLog {
  @Field(() => ID, { name: 'id', description: 'Database generated id.' })
  id: string;

  @Prop({ required: true })
  @Field({ description: 'Display name of the uploader.' })
  uploaderName: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Keycloak sub of the uploader.' })
  uploaderSub?: string;

  @Prop({ required: true })
  @Field({ description: 'Original file name of the uploaded spreadsheet.' })
  fileName: string;

  @Prop({ required: true, default: () => new Date() })
  @Field({ description: 'When the upload was performed.' })
  uploadDate: Date;

  @Prop({ required: true })
  @Field(() => Int, { description: 'Total rows in the uploaded file.' })
  rowCount: number;

  @Prop({ required: true, default: 0 })
  @Field(() => Int, { description: 'Items created.' })
  createdCount: number;

  @Prop({ required: true, default: 0 })
  @Field(() => Int, { description: 'Items updated.' })
  updatedCount: number;

  @Prop({ required: true, default: 0 })
  @Field(() => Int, { description: 'Items skipped.' })
  skippedCount: number;

  @Prop({ required: true, default: 0 })
  @Field(() => Int, { description: 'Items that failed.' })
  failedCount: number;

  @Prop({ type: [String], default: [] })
  @Field(() => [ID], { description: 'IDs of inventory items affected by this upload.' })
  affectedItemIds: string[];

  @Prop({ type: [FieldSnapshotSchema], default: [] })
  @Field(() => [FieldSnapshot], { description: 'Per-item before/after snapshots.' })
  fieldSnapshots: FieldSnapshot[];
}

export type UploadLogDocument = UploadLog & mongoose.Document;
export const UploadLogSchema = SchemaFactory.createForClass(UploadLog);

UploadLogSchema.index({ uploadDate: -1 });
