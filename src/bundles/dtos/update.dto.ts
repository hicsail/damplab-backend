import { Bundle } from '../bundles.model';
import { ID, InputType, OmitType, PartialType, Field } from '@nestjs/graphql';

/**
 * `omitDefaultValues` is load-bearing, not tidiness.
 *
 * Without it `PartialType` copies each inherited field's GraphQL `defaultValue`
 * onto this input. GraphQL then substitutes those defaults during argument
 * coercion for every field the client *omitted*, before the resolver runs, and
 * the update path `$set`s whatever it is handed — so a deliberately partial
 * update silently rewrites fields the caller never mentioned. See
 * `services/dtos/update.dto.spec.ts`, which pins this for every partial input.
 */
@InputType()
export class BundleChange extends PartialType(OmitType(Bundle, ['id', 'services'] as const), { decorator: InputType, omitDefaultValues: true }) {
  @Field(() => [ID], { nullable: true })
  services: string[];
}
