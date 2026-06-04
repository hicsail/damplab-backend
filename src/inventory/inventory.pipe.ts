import { Injectable, NotFoundException, PipeTransform } from '@nestjs/common';
import { InventoryItem } from './inventory.model';
import { InventoryService } from './inventory.service';

@Injectable()
export class InventoryItemPipe implements PipeTransform<string, Promise<InventoryItem>> {
  constructor(private readonly inventoryService: InventoryService) {}

  async transform(value: string): Promise<InventoryItem> {
    const item = await this.inventoryService.find(value);
    if (!item) {
      throw new NotFoundException(`InventoryItem with id ${value} not found`);
    }
    return item;
  }
}
