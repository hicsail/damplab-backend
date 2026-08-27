import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { InventoryItem } from './inventory.model';
import { InventoryService } from './inventory.service';
import { InventoryItemPipe } from './inventory.pipe';
import { CreateInventoryItem } from './dtos/create.dto';
import { InventoryItemChange } from './dtos/update.dto';

import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';

@Resolver(() => InventoryItem)
@UseGuards(AuthRolesGuard)
export class InventoryResolver {
  constructor(private readonly inventoryService: InventoryService) {}

  /** Everything, including soft-deleted items (for the admin catalog). */
  @Query(() => [InventoryItem], { description: 'All inventory items including soft-deleted ones (admin view). Requires inventory:read.' })
  @RequirePermission(Permission.InventoryRead)
  async inventoryItems(): Promise<InventoryItem[]> {
    return this.inventoryService.findAll();
  }

  /**
   * Active items only — for pickers (service editor, lab monitor, availability
   * board) and for BookInventory, which a plain client reaches. **Deliberately left
   * open**: narrowing it to `inventory:read` would break booking for anyone holding
   * `inventory:book` without `inventory:read`, and the two are separate cells.
   */
  @Query(() => [InventoryItem], { description: 'Active (non-deleted) inventory items for catalog pickers.' })
  async activeInventoryItems(): Promise<InventoryItem[]> {
    return this.inventoryService.findAllActive();
  }

  @Mutation(() => InventoryItem)
  @RequirePermission(Permission.InventoryWrite)
  async createInventoryItem(@Args('item', { type: () => CreateInventoryItem }) item: CreateInventoryItem): Promise<InventoryItem> {
    return this.inventoryService.create(item);
  }

  @Mutation(() => InventoryItem)
  @RequirePermission(Permission.InventoryWrite)
  async updateInventoryItem(
    @Args('item', { type: () => ID }, InventoryItemPipe) item: InventoryItem,
    @Args('changes', { type: () => InventoryItemChange }) changes: InventoryItemChange
  ): Promise<InventoryItem> {
    return this.inventoryService.update(item, changes);
  }

  /** Soft delete: sets isDeleted=true. Item stays resolvable so historical
   *  workflow nodes that referenced it still render with a name. */
  @Mutation(() => Boolean)
  @RequirePermission(Permission.InventoryWrite)
  async deleteInventoryItem(@Args('item', { type: () => ID }, InventoryItemPipe) item: InventoryItem): Promise<boolean> {
    await this.inventoryService.softDelete(item);
    return true;
  }
}
