import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { AnnouncementAudience } from '../audience/audience';

/**
 * One uploaded file in the Learning Hub.
 *
 * This replaced a markdown `Guide` model with an in-app editor. The lab did not want
 * to author documents in a browser textarea — they already write them elsewhere — so
 * what is left is the part that was actually missing: put a file somewhere people can
 * find it, and say who may have it.
 *
 * A **new collection**, deliberately. The old `guides` documents are left untouched
 * rather than migrated, because a markdown body cannot become a PDF automatically and
 * a half-migrated row would be worse than none. Their content is exported to
 * `docs/legacy-learning-hub/` for re-upload; the collection can be dropped whenever.
 */
@ObjectType({ description: 'A Learning Hub document: an uploaded PDF, visible to the audiences it is addressed to.' })
export class TrainingResourceFile {
  @Field({ description: 'S3 object key. Never handed to a browser directly — downloads go through a short-lived presigned URL.' })
  key: string;

  @Field({ description: 'Original filename, used for the download.' })
  filename: string;

  @Field()
  contentType: string;

  @Field(() => Int)
  size: number;
}

@Schema({ timestamps: true })
@ObjectType({ description: 'A Learning Hub document.' })
export class TrainingResource {
  @Field(() => ID, { name: 'id', description: 'unique database generated id' })
  _id: string;

  @Prop({ required: true })
  @Field({ description: 'Shown in the Learning Hub list.' })
  title: string;

  @Prop({ required: false, default: '' })
  @Field({ description: 'A sentence or two on what this is and who it is for.' })
  description: string;

  /**
   * Who may see and download this.
   *
   * **Required and non-empty**, unlike the announcement field this shares a
   * vocabulary with. That one treats absent-as-everyone because it had to keep
   * working for rows written before targeting existed; this field is new, so there is
   * no legacy encoding to preserve and no reason to accept an ambiguous one.
   *
   * This is authorization, not presentation: the list query filters on it and the
   * download resolver re-checks it, so a resource outside your audience never yields
   * a URL.
   */
  @Prop({ type: [String], required: true })
  @Field(() => [AnnouncementAudience], { description: 'Which access tiers may see and download this. Always at least one — there is no "everyone" shorthand here.' })
  audienceRoles: AnnouncementAudience[];

  @Prop({ type: Object, required: false })
  @Field(() => TrainingResourceFile, { nullable: true, description: 'Null between creating the record and finishing the upload.' })
  file?: TrainingResourceFile;

  @Prop({ required: false })
  @Field({ nullable: true })
  updatedAt?: Date;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Who last saved it.' })
  updatedBy?: string;

  /**
   * A short-lived presigned GET, minted per request.
   *
   * Resolved rather than stored: a presigned URL is a bearer token, so persisting one
   * on the document would turn an audience-restricted file into a link anyone could
   * pass on for as long as the URL lived.
   */
  @Field({ nullable: true, description: 'Short-lived download URL, minted per request for callers in the audience.' })
  downloadUrl?: string;
}

export type TrainingResourceDocument = TrainingResource & mongoose.Document;
export const TrainingResourceSchema = SchemaFactory.createForClass(TrainingResource);
