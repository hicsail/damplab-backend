import { Field, InputType, OmitType, PartialType } from '@nestjs/graphql';
import { InventoryItem, StationPlacementInput, DimensionInput } from '../inventory.model';

/**
 * See CreateInventoryItem for why `placements` and `dimensionL/W/H` are
 * re-declared rather than inherited.
 *
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
export class InventoryItemChange extends PartialType(OmitType(InventoryItem, ['id', 'placements', 'dimensionL', 'dimensionW', 'dimensionH'] as const), {
  decorator: InputType,
  omitDefaultValues: true
}) {
  @Field(() => [StationPlacementInput], { nullable: true })
  placements?: StationPlacementInput[];

  @Field(() => DimensionInput, { nullable: true })
  dimensionL?: DimensionInput;

  @Field(() => DimensionInput, { nullable: true })
  dimensionW?: DimensionInput;

  @Field(() => DimensionInput, { nullable: true })
  dimensionH?: DimensionInput;
}
