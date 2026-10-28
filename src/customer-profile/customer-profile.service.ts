import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CustomerProfile, CustomerProfileDocument, CustomerProfileEntity, PROFILE_FIELDS, UpdateCustomerProfileInput } from './customer-profile.model';

/** A stored record (or none) as the GraphQL shape: every absent field null, the flag false. */
export function toCustomerProfile(userSub: string, doc?: Partial<CustomerProfileEntity> | null): CustomerProfile {
  const out: any = { userSub, canBookWithoutApproval: doc?.canBookWithoutApproval === true };
  for (const f of PROFILE_FIELDS) out[f] = (doc as any)?.[f] ?? null;
  out.updatedAt = doc?.updatedAt ?? null;
  out.updatedBySub = doc?.updatedBySub ?? null;
  return out as CustomerProfile;
}

@Injectable()
export class CustomerProfileService {
  constructor(@InjectModel(CustomerProfileEntity.name) private readonly model: Model<CustomerProfileDocument>) {}

  async findBySub(sub: string): Promise<CustomerProfileEntity | null> {
    if (!sub) return null;
    return (await this.model.findOne({ userSub: sub }).lean().exec()) as CustomerProfileEntity | null;
  }

  /** One `$in` query for a whole list page. */
  async findBySubs(subs: string[]): Promise<Map<string, CustomerProfileEntity>> {
    const unique = [...new Set(subs.filter(Boolean))];
    if (!unique.length) return new Map();
    const docs = (await this.model
      .find({ userSub: { $in: unique } })
      .lean()
      .exec()) as CustomerProfileEntity[];
    return new Map(docs.map((d): [string, CustomerProfileEntity] => [d.userSub, d]));
  }

  /**
   * Set the fields present in `input`; leave absent ones untouched. A null or blank
   * string clears the field ($unset). The flag is never cleared, only set: null means false.
   */
  async upsert(sub: string, input: UpdateCustomerProfileInput, actorSub?: string): Promise<CustomerProfile> {
    const $set: Record<string, unknown> = { updatedAt: new Date(), updatedBySub: actorSub };
    const $unset: Record<string, ''> = {};
    if (input.canBookWithoutApproval !== undefined) $set.canBookWithoutApproval = input.canBookWithoutApproval === true;
    for (const f of PROFILE_FIELDS) {
      const value = (input as any)[f];
      if (value === undefined) continue;
      const cleaned = typeof value === 'string' ? value.trim() : value;
      if (cleaned === null || cleaned === '') $unset[f] = '';
      else $set[f] = cleaned;
    }
    const update: Record<string, unknown> = { $set };
    if (Object.keys($unset).length) update.$unset = $unset;
    // The schema default supplies canBookWithoutApproval: false on insert. Do not also
    // put it in $setOnInsert: Mongo refuses a path in both $set and $setOnInsert.
    const doc = await this.model.findOneAndUpdate({ userSub: sub }, update, { upsert: true, new: true, setDefaultsOnInsert: true }).lean().exec();
    return toCustomerProfile(sub, doc as CustomerProfileEntity | null);
  }

  /** Read live on every booking, so a change applies to the next one with no re-login. */
  async canBookWithoutApproval(sub?: string): Promise<boolean> {
    if (!sub) return false;
    return (await this.findBySub(sub))?.canBookWithoutApproval === true;
  }
}
