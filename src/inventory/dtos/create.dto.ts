import { Field, InputType, OmitType } from '@nestjs/graphql';
import { InventoryItem, StationPlacementInput, DimensionInput } from '../inventory.model';

/**
 * `placements` and `dimensions` must be re-declared: OmitType reuses the model's
 * field metadata, and the model types them as @ObjectType classes, which are not
 * legal GraphQL inputs. Overriding them here binds the @InputType twins instead.
 */
@InputType()
export class CreateInventoryItem extends OmitType(InventoryItem, ['id', 'isDeleted', 'placements', 'dimensions'] as const, InputType) {
  @Field(() => [StationPlacementInput], { nullable: true })
  placements?: StationPlacementInput[];

  @Field(() => [DimensionInput], { nullable: true })
  dimensions?: DimensionInput[];
}
