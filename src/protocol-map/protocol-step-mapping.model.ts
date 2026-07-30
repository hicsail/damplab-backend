import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ID, ObjectType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';

/**
 * Maps a single protocols.io step (by its stable guid) to a Canvas service and
 * required equipment. Stores ONLY references — never protocol content — keyed on
 * (protocolId, stepId), consistent with our fetch-protocols-dynamically approach.
 * A snapshot of the step number/title is kept purely to detect + surface drift if
 * the protocol is re-versioned on protocols.io (guids can change across versions).
 */
@Schema({ timestamps: true })
@ObjectType({ description: 'Author-defined mapping of one protocol step to a Canvas service + required equipment.' })
export class ProtocolStepMapping {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ required: true, index: true })
  @Field({ description: 'protocols.io protocol identifier.' })
  protocolId: string;

  @Prop({ required: true })
  @Field({ description: 'protocols.io step guid (stable per version).' })
  stepId: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Snapshot of the step number (drift detection / display).' })
  stepNumber?: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Snapshot of a short step title/label (NOT the protocol content).' })
  stepTitle?: string;

  /**
   * @deprecated Per-step service mapping was removed — the operation↔protocol
   * association lives on DampLabService.protocolIds, so choosing a service per
   * step was redundant and could contradict it. Existing values are left in
   * place rather than deleted, but nothing reads or writes this any more.
   */
  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'DampLabService', required: false })
  @Field(() => ID, {
    nullable: true,
    deprecationReason: 'Per-step service mapping removed; operations own their protocols via protocolIds.',
    description: 'Legacy per-step service reference. No longer read or written.'
  })
  serviceId?: string;

  @Prop({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem' }], default: [] })
  @Field(() => [ID], { description: 'Equipment required for this step (Step→Equipment).' })
  equipmentIds: string[];

  @Prop({ required: true, default: false })
  @Field(() => Boolean, { description: 'Explicitly reviewed as requiring no equipment (vs. not yet mapped).' })
  requiresNoEquipment: boolean;

  @Prop({ type: mongoose.Schema.Types.Mixed, default: [] })
  @Field(() => JSON, { nullable: true, description: 'Modular value tags: [{ label, value }] injected into runtime job params.' })
  paramTags?: any;

  @Prop({ required: true, default: false })
  @Field(() => Boolean, { description: 'Whether the author has reviewed this step.' })
  reviewed: boolean;

  @Prop({ required: false })
  @Field({ nullable: true })
  updatedBy?: string;
}

export type ProtocolStepMappingDocument = ProtocolStepMapping & Document;
export const ProtocolStepMappingSchema = SchemaFactory.createForClass(ProtocolStepMapping);
ProtocolStepMappingSchema.index({ protocolId: 1, stepId: 1 }, { unique: true });
