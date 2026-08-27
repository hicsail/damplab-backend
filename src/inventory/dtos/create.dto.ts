import { Field, InputType, OmitType } from '@nestjs/graphql';
import { InventoryItem, StationPlacementInput, DimensionInput } from '../inventory.model';

/**
 * `placements`, `dimensions` and `tags` must be re-declared.
 *
 * `placements` and `dimensions` because OmitType reuses the model's field metadata,
 * and the model types them as @ObjectType classes, which are not legal GraphQL
 * inputs. Overriding them here binds the @InputType twins instead.
 *
 * `tags` because the model declares it `@Field(() => [String])` with no `nullable`,
 * so inherited verbatim it makes the input type `[String!]!` and every create that
 * omits tags is rejected during variable coercion — before the resolver or any guard
 * runs. Fixed here rather than on the model deliberately: relaxing the model's
 * `@Field` would also change the *output* type to `[String]` for every reader, and
 * `defaultValue` is inert on an @ObjectType field.
 */
@InputType()
export class CreateInventoryItem extends OmitType(InventoryItem, ['id', 'isDeleted', 'placements', 'dimensions', 'tags'] as const, InputType) {
  @Field(() => [StationPlacementInput], { nullable: true })
  placements?: StationPlacementInput[];

  @Field(() => [DimensionInput], { nullable: true })
  dimensions?: DimensionInput[];

  @Field(() => [String], { nullable: true })
  tags?: string[];
}
