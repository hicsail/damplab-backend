import { Field, InputType, OmitType } from '@nestjs/graphql';
import { InventoryItem, StationPlacementInput, DimensionInput } from '../inventory.model';

/**
 * `placements`, `dimensionL/W/H` and `tags` must be re-declared.
 *
 * `placements` and the three dimensions because OmitType reuses the model's field
 * metadata, and the model types them as @ObjectType classes, which are not legal
 * GraphQL inputs. Overriding them here binds the @InputType twins instead.
 *
 * `tags` because the model declares it `@Field(() => [String])` with no `nullable`,
 * so inherited verbatim it makes the input type `[String!]!` and every create that
 * omits tags is rejected during variable coercion — before the resolver or any guard
 * runs. Fixed here rather than on the model deliberately: relaxing the model's
 * `@Field` would also change the *output* type to `[String]` for every reader, and
 * `defaultValue` is inert on an @ObjectType field.
 *
 * Note `InventoryItemChange` needs no such override — it wraps the model in
 * `PartialType`, which makes every field optional anyway.
 */
@InputType()
export class CreateInventoryItem extends OmitType(InventoryItem, ['id', 'isDeleted', 'placements', 'dimensionL', 'dimensionW', 'dimensionH', 'tags'] as const, InputType) {
  @Field(() => [StationPlacementInput], { nullable: true })
  placements?: StationPlacementInput[];

  @Field(() => DimensionInput, { nullable: true })
  dimensionL?: DimensionInput;

  @Field(() => DimensionInput, { nullable: true })
  dimensionW?: DimensionInput;

  @Field(() => DimensionInput, { nullable: true })
  dimensionH?: DimensionInput;

  @Field(() => [String], { nullable: true })
  tags?: string[];
}
