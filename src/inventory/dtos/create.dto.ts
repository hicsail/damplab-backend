import { Field, InputType, OmitType } from '@nestjs/graphql';
import { InventoryItem, StationPlacementInput } from '../inventory.model';

/**
 * `placements` must be re-declared: OmitType reuses the model's field metadata,
 * and the model types it as the @ObjectType `StationPlacement`, which is not a
 * legal GraphQL input. Overriding it here binds the @InputType twin instead.
 */
@InputType()
export class CreateInventoryItem extends OmitType(InventoryItem, ['id', 'isDeleted', 'placements'] as const, InputType) {
  @Field(() => [StationPlacementInput], { nullable: true })
  placements?: StationPlacementInput[];
}
