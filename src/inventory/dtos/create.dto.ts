import { InputType, OmitType } from '@nestjs/graphql';
import { InventoryItem } from '../inventory.model';

@InputType()
export class CreateInventoryItem extends OmitType(InventoryItem, ['id', 'isDeleted'] as const, InputType) {}
