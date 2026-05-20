import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { InventoryItem } from './inventory.model';
import { InventoryService } from './inventory.service';
import { InventoryItemPipe } from './inventory.pipe';
import { CreateInventoryItem } from './dtos/create.dto';
import { InventoryItemChange } from './dtos/update.dto';

import { AuthRolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/roles.enum';

@Resolver(() => InventoryItem)
@UseGuards(AuthRolesGuard)
export class InventoryResolver {
  constructor(private readonly inventoryService: InventoryService) {}

  /** Everything, including soft-deleted items (for the admin catalog). */
  @Query(() => [InventoryItem], { description: 'All inventory items including soft-deleted ones (admin view).' })
  async inventoryItems(): Promise<InventoryItem[]> {
    return this.inventoryService.findAll();
  }

  /** Active items only — for pickers (service editor, lab monitor, availability board). */
  @Query(() => [InventoryItem], { description: 'Active (non-deleted) inventory items for catalog pickers.' })
  async activeInventoryItems(): Promise<InventoryItem[]> {
    return this.inventoryService.findAllActive();
  }

  @Mutation(() => InventoryItem)
  @Roles(Role.DamplabStaff)
  async createInventoryItem(@Args('item', { type: () => CreateInventoryItem }) item: CreateInventoryItem): Promise<InventoryItem> {
    return this.inventoryService.create(item);
  }

  @Mutation(() => InventoryItem)
  @Roles(Role.DamplabStaff)
  async updateInventoryItem(
    @Args('item', { type: () => ID }, InventoryItemPipe) item: InventoryItem,
    @Args('changes', { type: () => InventoryItemChange }) changes: InventoryItemChange
  ): Promise<InventoryItem> {
    return this.inventoryService.update(item, changes);
  }

  /** Soft delete: sets isDeleted=true. Item stays resolvable so historical
   *  workflow nodes that referenced it still render with a name. */
  @Mutation(() => Boolean)
  @Roles(Role.DamplabStaff)
  async deleteInventoryItem(@Args('item', { type: () => ID }, InventoryItemPipe) item: InventoryItem): Promise<boolean> {
    await this.inventoryService.softDelete(item);
    return true;
  }
}
