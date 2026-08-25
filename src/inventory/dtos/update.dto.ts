import { Field, InputType, OmitType, PartialType } from '@nestjs/graphql';
import { InventoryItem, StationPlacementInput, DimensionInput } from '../inventory.model';

/** See CreateInventoryItem for why `placements` and `dimensions` are re-declared rather than inherited. */
@InputType()
export class InventoryItemChange extends PartialType(OmitType(InventoryItem, ['id', 'placements', 'dimensions'] as const), InputType) {
  @Field(() => [StationPlacementInput], { nullable: true })
  placements?: StationPlacementInput[];

  @Field(() => [DimensionInput], { nullable: true })
  dimensions?: DimensionInput[];
}
