import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Field, ObjectType, ID, Int } from '@nestjs/graphql';

/**
 * A named block of boilerplate text staff can drop into one prose section of a
 * SOW. The library is per-section: a block for `invoiceProcedures` is never
 * offered for `completionCriteria`.
 *
 * Blocks are a *source* of text, not a link to it. Choosing one copies its words
 * into the SOW and the SOW keeps no reference back, so editing or deleting a
 * block can never reach into a document that already exists. That is why there
 * is no soft-delete here and no dangling-reference story to tell.
 */
@Schema({ collection: 'sow_text_presets' })
@ObjectType({ description: 'A reusable block of text for one prose section of a SOW' })
export class SowTextPreset {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ required: true })
  @Field({ description: 'Key of the SOW_FIELD_CATALOG section this block belongs to, e.g. "invoiceProcedures"' })
  sectionKey: string;

  @Prop({ required: true })
  @Field({ description: 'Staff-facing name, e.g. "Default" or "Net-30 terms"' })
  name: string;

  // Not `required`: Mongoose treats '' as missing, and a block created from the
  // "New text block preset" button starts empty by design — staff name it and
  // type into it afterwards.
  @Prop({ default: '' })
  @Field({ defaultValue: '', description: 'The text itself. Plain text; lines beginning "- " are bullets.' })
  text: string;

  /**
   * Rank within the section, ascending. Spaced by 10 on every write so a block
   * can be slotted between two others without renumbering — the same convention
   * SOW_FIELD_CATALOG uses for section order.
   *
   * Rank 1 *is* the section's default. Deriving the default from position rather
   * than storing an `isDefault` flag means there is only one thing to keep true;
   * a flag could disagree with the order, and then neither would be believable.
   */
  @Prop({ required: true, default: 0 })
  @Field(() => Int, { description: 'Rank within the section, ascending. The lowest is the section default.' })
  order: number;

  @Prop({ required: true })
  @Field({ description: 'Keycloak sub or email of whoever created the block' })
  createdBy: string;

  @Prop({ default: '' })
  @Field({ defaultValue: '', description: 'Display name of the creator, resolved at write time' })
  createdByName: string;

  @Prop({ required: true, default: () => new Date() })
  @Field()
  createdAt: Date;

  @Prop({ required: true })
  @Field({ description: 'Keycloak sub or email of whoever last edited the block' })
  updatedBy: string;

  @Prop({ default: '' })
  @Field({ defaultValue: '', description: 'Display name of the last editor, resolved at write time — this is what the dropdown shows' })
  updatedByName: string;

  @Prop({ required: true, default: () => new Date() })
  @Field()
  updatedAt: Date;
}

export type SowTextPresetDocument = SowTextPreset & Document;
export const SowTextPresetSchema = SchemaFactory.createForClass(SowTextPreset);

// Serves both the per-section listing and the whole-library read the SOW editor
// makes, each of which wants section order.
SowTextPresetSchema.index({ sectionKey: 1, order: 1 });

/** One row of the Catalog Editor's SOW table: a section and the state of its library. */
@ObjectType({ description: 'A SOW prose section and a summary of its text-block library' })
export class SowPresetSection {
  @Field({ description: 'Catalog key, e.g. "invoiceProcedures"' })
  key: string;

  @Field({ description: 'Section heading as it appears in the document' })
  label: string;

  @Field(() => Int, { description: 'How many blocks the section has' })
  presetCount: number;

  @Field({ nullable: true, description: 'Name of the rank-1 block, or null when the section has none yet' })
  defaultName?: string;

  @Field({ nullable: true, description: 'When any block in this section was last edited' })
  updatedAt?: Date;

  @Field({ nullable: true, description: 'Who last edited a block in this section' })
  updatedByName?: string;
}
