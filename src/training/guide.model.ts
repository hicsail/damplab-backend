import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';

/**
 * One Learning Hub guide.
 *
 * The three training pages were 100% hardcoded JSX with no backend behind them, so
 * `training:write` was granted to Administrator and read by nothing. This is the
 * model that makes it mean something.
 *
 * Body is **markdown**, rendered by the same component the announcements already
 * use. Images are external URLs written into that markdown — there is deliberately
 * no upload path, no S3 and no new bucket config.
 */
@Schema({ timestamps: true })
@ObjectType({ description: 'A Learning Hub guide: markdown content, grouped by category.' })
export class Guide {
  @Field(() => ID, { name: 'id', description: 'unique database generated id' })
  _id: string;

  @Prop({ required: true })
  @Field({ description: 'Guide title, shown in the list and as the page heading.' })
  title: string;

  /**
   * The URL segment. Unique so `/training/:slug` resolves to exactly one guide, and
   * stable so a link into a guide survives a retitle.
   */
  @Prop({ required: true, unique: true, index: true })
  @Field({ description: 'URL segment for /training/:slug. Unique; stable across retitles.' })
  slug: string;

  @Prop({ required: false, default: 'General' })
  @Field({ nullable: true, description: 'Grouping heading on the Learning Hub list.' })
  category?: string;

  @Prop({ required: false, default: '' })
  @Field({ description: 'Markdown body. Images go in as external URLs; there is no upload path.' })
  body: string;

  @Prop({ required: false, default: 0 })
  @Field(() => Int, { nullable: true, description: 'Sort position within its category. Ties break on title.' })
  order?: number;

  /**
   * Unpublished guides are visible only to `training:write` holders — a draft you
   * are still writing should not be on the customer-facing Learning Hub.
   */
  @Prop({ required: false, default: false, index: true })
  @Field(() => Boolean, { nullable: true, description: 'Published guides are visible to everyone; drafts only to training:write holders.' })
  isPublished?: boolean;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'When it was last saved.' })
  updatedAt?: Date;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Who last saved it.' })
  updatedBy?: string;
}

export type GuideDocument = Guide & mongoose.Document;
export const GuideSchema = SchemaFactory.createForClass(Guide);
