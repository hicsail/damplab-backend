import { Field, InputType, OmitType, PartialType } from '@nestjs/graphql';
import { InventoryItem, StationPlacementInput, DimensionInput } from '../inventory.model';

/** See CreateInventoryItem for why `placements` and `dimensionL/W/H` are re-declared rather than inherited. */
@InputType()
export class InventoryItemChange extends PartialType(OmitType(InventoryItem, ['id', 'placements', 'dimensionL', 'dimensionW', 'dimensionH'] as const), InputType) {
  @Field(() => [StationPlacementInput], { nullable: true })
  placements?: StationPlacementInput[];

  @Field(() => DimensionInput, { nullable: true })
  dimensionL?: DimensionInput;

  @Field(() => DimensionInput, { nullable: true })
  dimensionW?: DimensionInput;

  @Field(() => DimensionInput, { nullable: true })
  dimensionH?: DimensionInput;
}
