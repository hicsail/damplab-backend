import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import mongoose from 'mongoose';
import { Field, ObjectType, ID, Int, Float, registerEnumType } from '@nestjs/graphql';
import { SOWStatus, SOWAdjustmentType } from './sow.model';

/**
 * A SOW version is an immutable snapshot of the document. Save, send, sign,
 * finalize and cancel each insert a new one; nothing is ever updated in place.
 *
 * Two pointers on the parent SOW decide what each audience sees:
 *   currentVersionNumber — the latest version, what staff edit
 *   activeVersionNumber  — the version in force with the customer
 * They differ whenever staff are drafting changes to an already-issued SOW, which
 * is why a draft never invalidates a signature.
 */

export enum SowFieldKind {
  /** Generated from structured inputs (dates, staff, pricing). */
  CALCULATED = 'CALCULATED',
  /** Boilerplate prose with a default staff can edit. */
  PROSE = 'PROSE',
  /** Added ad hoc by staff on this SOW. */
  CUSTOM = 'CUSTOM'
}
registerEnumType(SowFieldKind, { name: 'SowFieldKind' });

@Schema({ _id: false })
@ObjectType({ description: 'One section of the SOW document' })
export class SowField {
  @Prop({ required: true })
  @Field({ description: 'Stable identifier, e.g. "feeSchedule" or "custom-<uuid>"' })
  key: string;

  @Prop({ required: true })
  @Field({ description: 'Heading shown above this section' })
  label: string;

  @Prop({ required: true })
  @Field(() => SowFieldKind)
  kind: SowFieldKind;

  @Prop({ required: true })
  @Field(() => Int, { description: 'Document order; ascending' })
  order: number;

  @Prop({ required: true })
  @Field({ description: 'Text shown to the reader. Plain text; lines beginning "- " are bullets.' })
  value: string;

  @Prop({ required: false })
  @Field({
    description: 'What the generator produced for this field, kept alongside any override so "revert to calculated" has a current target.',
    nullable: true
  })
  calculatedValue?: string;

  @Prop({ required: true, default: false })
  @Field({ description: 'True when a staff member replaced the generated text by hand' })
  isOverridden: boolean;

  @Prop({ required: true, default: true })
  @Field({ description: 'When false the section is retained but hidden from the customer, the PDF and consent' })
  isEnabled: boolean;

  @Prop({ required: true, default: true })
  @Field({
    description: 'False on fields whose text carries figures another system bills from (Fee Schedule), where free-text editing would let the document disagree with the invoice'
  })
  allowsTextOverride: boolean;

  @Prop({ required: true, default: true })
  @Field({ description: 'False on fields the document cannot be sent to the customer without (e.g. Engagement Resources needs a Project Manager and Project Lead)' })
  allowsEmpty: boolean;

  @Prop({ required: true, default: false })
  @Field({ description: 'Staff flag: when true, the customer must type their initials for this section before they can sign' })
  requiresInitials: boolean;
}

/**
 * What the preview query returns: the generated text for a field, and nothing
 * else. The editor holds its own value / isOverridden / isEnabled — including
 * unsaved edits the server has never seen — so returning whole rows here would
 * overwrite work in progress every time a dropdown changed.
 */
@ObjectType({ description: 'Generated text for one field, for live preview while editing' })
export class SowCalculatedValue {
  @Field()
  key: string;

  @Field()
  calculatedValue: string;
}

@Schema({ _id: false })
@ObjectType({ description: 'A single period of performance; a SOW may have several, non-consecutive or retroactive' })
export class SowPeriod {
  @Prop({ required: true })
  @Field()
  startDate: Date;

  @Prop({ required: true })
  @Field(() => Int)
  durationDays: number;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Optional name, e.g. "Phase 1"' })
  label?: string;
}

@Schema({ _id: false })
@ObjectType({ description: 'Service line as frozen into this version' })
export class SowVersionService {
  @Prop({ required: true })
  @Field(() => ID)
  serviceId: string;

  @Prop({ required: true })
  @Field()
  name: string;

  @Prop({ required: true, default: '' })
  @Field()
  description: string;

  @Prop({ required: true })
  @Field(() => Float)
  cost: number;

  @Prop({ required: false })
  @Field(() => Float, { nullable: true, description: 'The run-count multiplier baked into cost, if the underlying node has one. Informational only — Fee Schedule has no control to edit it.' })
  runCount?: number;
}

@Schema({ _id: false })
@ObjectType({ description: 'Pricing adjustment as frozen into this version' })
export class SowVersionAdjustment {
  @Prop({ required: true })
  @Field(() => SOWAdjustmentType)
  type: SOWAdjustmentType;

  @Prop({ required: true })
  @Field()
  description: string;

  @Prop({ required: true })
  @Field(() => Float)
  amount: number;

  @Prop({ required: false })
  @Field({ nullable: true })
  reason?: string;
}

/**
 * The structured drivers behind the calculated fields, frozen at save time.
 * Reloading a version into the editor restores these controls, and comparing them
 * against the SOW's live billing core is how documentStale is decided.
 */
@Schema({ _id: false })
@ObjectType({ description: 'Structured inputs that generated this version' })
export class SowVersionInputs {
  @Prop({ required: true, default: '' })
  @Field({ defaultValue: '' })
  projectManager: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Keycloak sub of the project manager' })
  projectManagerId?: string;

  @Prop({ required: true, default: '' })
  @Field({ defaultValue: '' })
  projectLead: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Keycloak sub of the project lead' })
  projectLeadId?: string;

  @Prop({ type: [mongoose.Schema.Types.Mixed], default: [] })
  @Field(() => [SowPeriod])
  periods: SowPeriod[];

  @Prop({ required: false })
  @Field({ nullable: true })
  sowTitle?: string;

  @Prop({ type: [String], default: [] })
  @Field(() => [String])
  scopeOfWork: string[];

  @Prop({ type: [String], default: [] })
  @Field(() => [String])
  deliverables: string[];

  @Prop({ type: [mongoose.Schema.Types.Mixed], default: [] })
  @Field(() => [SowVersionService])
  services: SowVersionService[];

  @Prop({ type: [mongoose.Schema.Types.Mixed], default: [] })
  @Field(() => [SowVersionAdjustment])
  adjustments: SowVersionAdjustment[];

  @Prop({ required: true, default: 0 })
  @Field(() => Float)
  baseCost: number;

  @Prop({ required: true, default: 0 })
  @Field(() => Float)
  totalCost: number;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Pricing category of the job at the time this version was written' })
  customerCategory?: string;
}

@Schema({ _id: false })
@ObjectType({ description: 'Initials a signer typed for one section flagged as requiring them' })
export class SowSectionInitial {
  @Prop({ required: true })
  @Field({ description: 'Section key the initials were given for' })
  key: string;

  @Prop({ required: true, default: '' })
  @Field({ defaultValue: '', description: "Section's label at the time it was signed, for display without a fields lookup" })
  label: string;

  @Prop({ required: true })
  @Field({ description: 'Initials as typed by the signer' })
  initials: string;
}

/**
 * A customer's or staff member's assent. Consent is per field-kind: the reader
 * ticks one box for the calculated figures, one for the standard prose, one for
 * any custom sections, so what they agreed to is recorded rather than implied.
 */
@Schema({ _id: false })
@ObjectType({ description: 'Signature captured as typed name plus per-group consent' })
export class SowConsent {
  @Prop({ required: true })
  @Field()
  name: string;

  @Prop({ required: true })
  @Field()
  signedAt: Date;

  @Prop({ type: [String], default: [] })
  @Field(() => [SowFieldKind], { description: 'Field kinds the signer explicitly acknowledged' })
  consentedGroups: SowFieldKind[];

  @Prop({ type: [mongoose.Schema.Types.Mixed], default: [] })
  @Field(() => [SowSectionInitial], { description: 'Initials given for each section staff flagged requiresInitials' })
  sectionInitials: SowSectionInitial[];

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Keycloak sub of the signer' })
  bySub?: string;

  @Prop({ required: false })
  @Field({
    nullable: true,
    description: 'Drawn signature carried over from the pre-versioning flow, so migrated SOWs still export with the image the customer actually drew. Never set for new signatures.'
  })
  legacySignatureDataUrl?: string;
}

@Schema({ collection: 'sow_versions' })
@ObjectType({ description: 'Immutable snapshot of a Statement of Work' })
export class SowVersion {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, ref: 'SOW', required: true })
  sow: mongoose.Types.ObjectId;

  @Prop({ required: true })
  @Field(() => ID, { description: 'Parent SOW id (string mirror, for querying)' })
  sowId: string;

  @Prop({ required: true })
  @Field(() => Int, {
    description:
      'Sortable, unique key, and the encoding of the human-facing "<sent-count>.<sub-revision>" label in one number: major*1000 + minor. See displayVersion for the decoded "1.2" form — SowVersionService.encodeVersionNumber/decodeVersionNumber own the encoding.'
  })
  versionNumber: number;

  // displayVersion has no class property: it is resolved purely from
  // versionNumber by SowVersionFieldsResolver, so it can never be forgotten on
  // one write path and present on another.

  @Prop({ type: [mongoose.Schema.Types.Mixed], default: [] })
  @Field(() => [SowField], { description: 'The document, in order' })
  fields: SowField[];

  @Prop({ type: mongoose.Schema.Types.Mixed, required: true })
  @Field(() => SowVersionInputs)
  inputs: SowVersionInputs;

  @Prop({ required: true, default: SOWStatus.DRAFT })
  @Field(() => SOWStatus)
  status: SOWStatus;

  @Prop({ required: true, default: false })
  @Field({ description: 'True once this version has been issued: sent, signed, finalized or cancelled' })
  visibleToCustomer: boolean;

  @Prop({ required: false })
  @Field({ nullable: true })
  sentToCustomerAt?: Date;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  @Field(() => SowConsent, { nullable: true })
  clientSignature?: SowConsent;

  @Prop({ type: mongoose.Schema.Types.Mixed, required: false })
  @Field(() => SowConsent, { nullable: true, description: 'BU countersignature captured at finalize' })
  staffSignature?: SowConsent;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Optional note describing what changed' })
  note?: string;

  @Prop({ required: true, default: false })
  @Field({ description: 'Unsent draft the staff abandoned; hidden from history by default' })
  isDiscarded: boolean;

  @Prop({ required: true })
  @Field({ description: 'Keycloak sub or email of the author' })
  createdBy: string;

  @Prop({ required: true, default: '' })
  @Field({ defaultValue: '', description: 'Display name of the author, resolved at write time' })
  createdByName: string;

  @Prop({ required: true, default: () => new Date() })
  @Field()
  createdAt: Date;
}

export type SowVersionDocument = SowVersion & Document;
export const SowVersionSchema = SchemaFactory.createForClass(SowVersion);

// One version number per SOW; also the index that serves history listing (newest first).
SowVersionSchema.index({ sowId: 1, versionNumber: -1 }, { unique: true });
// Customer-visible history.
SowVersionSchema.index({ sowId: 1, visibleToCustomer: 1 });
