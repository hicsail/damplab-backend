import { Field, InputType, OmitType } from '@nestjs/graphql';
import { InventoryItem, StationPlacementInput, DimensionInput } from '../inventory.model';

/**
 * `placements` and `dimensionL/W/H` must be re-declared: OmitType reuses the model's
 * field metadata, and the model types them as @ObjectType classes, which are not
 * legal GraphQL inputs. Overriding them here binds the @InputType twins instead.
 */
@InputType()
export class CreateInventoryItem extends OmitType(InventoryItem, ['id', 'isDeleted', 'placements', 'dimensionL', 'dimensionW', 'dimensionH'] as const, InputType) {
  @Field(() => [StationPlacementInput], { nullable: true })
  placements?: StationPlacementInput[];

  @Field(() => DimensionInput, { nullable: true })
  dimensionL?: DimensionInput;

  @Field(() => DimensionInput, { nullable: true })
  dimensionW?: DimensionInput;

  @Field(() => DimensionInput, { nullable: true })
  dimensionH?: DimensionInput;
}
