import { Field, InputType, OmitType, PartialType } from '@nestjs/graphql';
import { InventoryItem, StationPlacementInput } from '../inventory.model';

/** See CreateInventoryItem for why `placements` is re-declared rather than inherited. */
@InputType()
export class InventoryItemChange extends PartialType(OmitType(InventoryItem, ['id', 'placements'] as const), InputType) {
  @Field(() => [StationPlacementInput], { nullable: true })
  placements?: StationPlacementInput[];
}
