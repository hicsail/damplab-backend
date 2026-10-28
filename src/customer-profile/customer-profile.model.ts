import { Field, ID, InputType, ObjectType, registerEnumType } from '@nestjs/graphql';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum CustomerProfileStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ONBOARDING = 'ONBOARDING'
}
export enum SwipeCategory {
  DAMP_USER = 'DAMP_USER',
  DAMP_PERSONNEL = 'DAMP_PERSONNEL'
}
export enum SciShieldTrainings {
  COMPLETE = 'COMPLETE',
  NEED = 'NEED',
  CERTIFICATES = 'CERTIFICATES',
  NA_BSL1 = 'NA_BSL1'
}
export enum RohpStatus {
  NA = 'NA',
  NEED = 'NEED',
  COMPLETE = 'COMPLETE'
}

registerEnumType(CustomerProfileStatus, { name: 'CustomerProfileStatus' });
registerEnumType(SwipeCategory, { name: 'SwipeCategory' });
registerEnumType(SciShieldTrainings, { name: 'SciShieldTrainings' });
registerEnumType(RohpStatus, { name: 'RohpStatus' });

/** The 16 roster fields, in the order the human listed them. Stored only; nothing else in Canvas reads them. */
export const PROFILE_FIELDS = [
  'position',
  'instrumentType',
  'group',
  'start',
  'end',
  'status',
  'firstName',
  'lastName',
  'buId',
  'preferredEmail',
  'swipeCategory',
  'swipeAccess',
  'reportsTo',
  'sciShieldTrainings',
  'rohp',
  'affiliations'
] as const;
export type ProfileField = typeof PROFILE_FIELDS[number];

/**
 * A lab user's roster record, keyed by Keycloak `sub`. A user with no document reads as
 * every field null and `canBookWithoutApproval: false` — today's behaviour — so no migration.
 *
 * `firstName` / `lastName` / `preferredEmail` are the lab's own copy and are independent of
 * Keycloak: nothing writes them back, and notifications never read them.
 */
@Schema({ collection: 'customer_profiles' })
export class CustomerProfileEntity {
  @Prop({ type: String, required: true, unique: true })
  userSub: string;

  @Prop({ type: Boolean, default: false })
  canBookWithoutApproval: boolean;

  @Prop({ type: String }) position?: string;
  @Prop({ type: String }) instrumentType?: string;
  @Prop({ type: String }) group?: string;
  @Prop({ type: String }) start?: string;
  @Prop({ type: String }) end?: string;
  @Prop({ type: String, enum: Object.values(CustomerProfileStatus) }) status?: CustomerProfileStatus;
  @Prop({ type: String }) firstName?: string;
  @Prop({ type: String }) lastName?: string;
  @Prop({ type: String }) buId?: string;
  @Prop({ type: String }) preferredEmail?: string;
  @Prop({ type: String, enum: Object.values(SwipeCategory) }) swipeCategory?: SwipeCategory;
  @Prop({ type: String }) swipeAccess?: string;
  @Prop({ type: String }) reportsTo?: string;
  @Prop({ type: String, enum: Object.values(SciShieldTrainings) }) sciShieldTrainings?: SciShieldTrainings;
  @Prop({ type: String, enum: Object.values(RohpStatus) }) rohp?: RohpStatus;
  @Prop({ type: String }) affiliations?: string;

  @Prop({ type: Date }) updatedAt?: Date;
  @Prop({ type: String }) updatedBySub?: string;
}

export type CustomerProfileDocument = CustomerProfileEntity & Document;
export const CustomerProfileSchema = SchemaFactory.createForClass(CustomerProfileEntity);

@ObjectType({ description: "Customer Management's stored record for one user. All fields null and the flag false when nothing is stored." })
export class CustomerProfile {
  @Field(() => ID) userSub: string;

  @Field(() => Boolean, { description: "When true, this user's job equipment bookings are created RESERVED, with no approval step." })
  canBookWithoutApproval: boolean;

  @Field(() => String, { nullable: true }) position: string | null;
  @Field(() => String, { nullable: true }) instrumentType: string | null;
  @Field(() => String, { nullable: true }) group: string | null;
  @Field(() => String, { nullable: true }) start: string | null;
  @Field(() => String, { nullable: true }) end: string | null;
  @Field(() => CustomerProfileStatus, { nullable: true, description: 'Stored only: Inactive blocks neither sign-in nor booking.' }) status: CustomerProfileStatus | null;
  @Field(() => String, { nullable: true, description: 'Independent of the Keycloak name.' }) firstName: string | null;
  @Field(() => String, { nullable: true, description: 'Independent of the Keycloak name.' }) lastName: string | null;
  @Field(() => String, { nullable: true }) buId: string | null;
  @Field(() => String, { nullable: true, description: 'Stored only: notifications still go to the Keycloak email.' }) preferredEmail: string | null;
  @Field(() => SwipeCategory, { nullable: true }) swipeCategory: SwipeCategory | null;
  @Field(() => String, { nullable: true }) swipeAccess: string | null;
  @Field(() => String, { nullable: true }) reportsTo: string | null;
  @Field(() => SciShieldTrainings, { nullable: true }) sciShieldTrainings: SciShieldTrainings | null;
  @Field(() => RohpStatus, { nullable: true }) rohp: RohpStatus | null;
  @Field(() => String, { nullable: true }) affiliations: string | null;

  @Field(() => Date, { nullable: true }) updatedAt: Date | null;
  @Field(() => String, { nullable: true }) updatedBySub: string | null;
}

/** Every field optional. Absent = untouched; null or '' = cleared. */
@InputType()
export class UpdateCustomerProfileInput {
  @Field(() => Boolean, { nullable: true }) canBookWithoutApproval?: boolean | null;
  @Field(() => String, { nullable: true }) position?: string | null;
  @Field(() => String, { nullable: true }) instrumentType?: string | null;
  @Field(() => String, { nullable: true }) group?: string | null;
  @Field(() => String, { nullable: true }) start?: string | null;
  @Field(() => String, { nullable: true }) end?: string | null;
  @Field(() => CustomerProfileStatus, { nullable: true }) status?: CustomerProfileStatus | null;
  @Field(() => String, { nullable: true }) firstName?: string | null;
  @Field(() => String, { nullable: true }) lastName?: string | null;
  @Field(() => String, { nullable: true }) buId?: string | null;
  @Field(() => String, { nullable: true }) preferredEmail?: string | null;
  @Field(() => SwipeCategory, { nullable: true }) swipeCategory?: SwipeCategory | null;
  @Field(() => String, { nullable: true }) swipeAccess?: string | null;
  @Field(() => String, { nullable: true }) reportsTo?: string | null;
  @Field(() => SciShieldTrainings, { nullable: true }) sciShieldTrainings?: SciShieldTrainings | null;
  @Field(() => RohpStatus, { nullable: true }) rohp?: RohpStatus | null;
  @Field(() => String, { nullable: true }) affiliations?: string | null;
}
