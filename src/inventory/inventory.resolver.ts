import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { InventoryItem } from './inventory.model';
import { InventoryService } from './inventory.service';
import { InventoryItemPipe } from './inventory.pipe';
import { CreateInventoryItem } from './dtos/create.dto';
import { InventoryItemChange } from './dtos/update.dto';

import { AuthRolesGuard } from '../auth/auth.guard';
import { Public } from '../auth/roles/roles.decorator';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { hasPermission } from '../auth/permissions/permissions';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { Pricing } from '../pricing/pricing.model';
import { visiblePricing } from '../pricing/pricing-visibility';

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

  /**
   * Unauthenticated inventory list, for the public-facing site.
   *
   * `@Public()` short-circuits the guard *before* any permission check, so this is
   * the one query here with no caller at all. That is safe in the direction that
   * matters: the field resolvers below receive `user: undefined`, so
   * `hasPermission` is false and every internal field and every pricing tier
   * resolves to null. `uniqueId` is stripped explicitly because it has no field
   * resolver of its own.
   */
  @Public()
  @Query(() => [InventoryItem], { description: 'Public inventory list with sensitive fields hidden. No authentication required.' })
  async publicInventoryItems(): Promise<InventoryItem[]> {
    const items = await this.inventoryService.findAllActive();
    return items.map((item) => {
      const doc = { ...item } as any;
      doc.uniqueId = undefined;
      doc.serialNumber = undefined;
      return doc;
    });
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

  /**
   * Hard-delete every inventory item. Used before a full re-upload.
   *
   * Came in from main gated `@Roles(Role.DamplabStaff)`; carried over to
   * `inventory:write`, which the matrix gives to Administrator alone — the same set,
   * expressed in the vocabulary the rest of this resolver uses. Leaving the `@Roles`
   * beside the others would have been the one shape this codebase warns about.
   */
  @Mutation(() => Int, { description: 'Delete all inventory items (hard delete). Returns the number of items deleted. Requires inventory:write.' })
  @RequirePermission(Permission.InventoryWrite)
  async deleteAllInventoryItems(): Promise<number> {
    return this.inventoryService.deleteAll();
  }

  // Q4, enforced. All three of these already carried doc comments claiming a
  // restriction that nothing implemented. Nulled by permission rather than removed
  // from the query, so the one shared shape keeps working for staff.

  @ResolveField(() => String, { nullable: true })
  serialNumber(@Parent() item: InventoryItem, @CurrentUser() user: User): string | undefined {
    return hasPermission(user, Permission.InternalFieldsRead) ? item.serialNumber : undefined;
  }

  @ResolveField(() => Boolean, { nullable: true })
  hasServiceContract(@Parent() item: InventoryItem, @CurrentUser() user: User): boolean | undefined {
    return hasPermission(user, Permission.InternalFieldsRead) ? item.hasServiceContract : undefined;
  }

  @ResolveField(() => Date, { nullable: true })
  serviceContractExpiration(@Parent() item: InventoryItem, @CurrentUser() user: User): Date | undefined {
    return hasPermission(user, Permission.InternalFieldsRead) ? item.serviceContractExpiration : undefined;
  }

  /**
   * Booking rates by customer category — the same leak as the service catalog, on
   * the same shared query. `activeInventoryItems` is deliberately open (it feeds
   * BookInventory, which a plain client reaches), so without this a client could
   * read every other tier's hourly rate straight off the endpoint.
   */
  @ResolveField(() => Pricing, { nullable: true })
  pricing(@Parent() item: InventoryItem, @CurrentUser() user: User): Pricing | undefined {
    return visiblePricing(item.pricing, user);
  }
}
