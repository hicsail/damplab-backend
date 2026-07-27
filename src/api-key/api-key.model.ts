import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * A read-only API key that lets an external system query the GraphQL API without
 * a Keycloak login. The raw secret is shown to staff exactly once at creation;
 * we persist only its SHA-256 hash. Keys are query-only — the auth guard blocks
 * any mutation made with a key (see AuthRolesGuard).
 */
@Schema({ timestamps: true })
@ObjectType({ description: 'A read-only API key for external systems to query the GraphQL API.' })
export class ApiKey {
  @Field(() => ID, { name: 'id' })
  _id: string;

  @Prop({ required: true })
  @Field({ description: 'Human-readable label for the key (e.g. "LIMS export", "Dashboard sync").' })
  name: string;

  @Prop({ required: true, index: true })
  @Field({ description: 'Non-secret display prefix of the key (e.g. "dl_ab12cd34").' })
  prefix: string;

  // SHA-256 of the full raw key. Never exposed via GraphQL (no @Field).
  @Prop({ required: true, index: true })
  hashedKey: string;

  @Prop({ required: true, default: 'read' })
  @Field({ description: 'Access scope. Currently always "read" (query-only).' })
  scope: string;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Who created the key.' })
  createdBy?: string;

  @Prop({ required: true, default: () => new Date() })
  @Field({ description: 'When the key was created.' })
  createdAt: Date;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'When the key was last used to authenticate a request.' })
  lastUsedAt?: Date;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'Optional expiry; the key is rejected after this time.' })
  expiresAt?: Date;

  @Prop({ required: true, default: false })
  @Field({ description: 'Whether the key has been revoked (rejected immediately).' })
  revoked: boolean;

  @Prop({ required: false })
  @Field({ nullable: true, description: 'When the key was revoked.' })
  revokedAt?: Date;
}

export type ApiKeyDocument = ApiKey & Document;
export const ApiKeySchema = SchemaFactory.createForClass(ApiKey);
