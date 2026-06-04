import { InputType, OmitType, PartialType } from '@nestjs/graphql';
import { InventoryItem } from '../inventory.model';

@InputType()
export class InventoryItemChange extends PartialType(OmitType(InventoryItem, ['id'] as const), InputType) {}
