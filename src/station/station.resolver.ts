import { Args, ID, Mutation, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { Station } from './station.model';
import { StationService } from './station.service';
import { CreateStationInput, UpdateStationInput } from './station.dto';
import { InventoryItem } from '../inventory/inventory.model';
import { InventoryService } from '../inventory/inventory.service';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';

/**
 * The class-level `@Roles(Role.DamplabStaff)` this replaces covered the *read*
 * query too, so `/stations` 403'd on load for a `lab-layout:read` holder rather
 * than merely refusing the save. Read and write are split per the matrix.
 */
@Resolver(() => Station)
@UseGuards(AuthRolesGuard)
export class StationResolver {
  constructor(private readonly stationService: StationService, private readonly inventoryService: InventoryService) {}

  @Query(() => [Station], { description: 'All lab stations (active by default).' })
  @RequirePermission(Permission.LabLayoutRead)
  async stations(@Args('includeDeleted', { nullable: true }) includeDeleted?: boolean): Promise<Station[]> {
    return this.stationService.findAll(!!includeDeleted);
  }

  @Query(() => Station, { nullable: true })
  @RequirePermission(Permission.LabLayoutRead)
  async station(@Args('id', { type: () => ID }) id: string): Promise<Station | null> {
    return this.stationService.findById(id);
  }

  @Mutation(() => Station)
  @RequirePermission(Permission.LabLayoutWrite)
  async createStation(@Args('input') input: CreateStationInput): Promise<Station> {
    return this.stationService.create(input);
  }

  @Mutation(() => Station)
  @RequirePermission(Permission.LabLayoutWrite)
  async updateStation(@Args('input') input: UpdateStationInput): Promise<Station> {
    return this.stationService.update(input);
  }

  @Mutation(() => Station, { description: 'Soft-delete a station. Equipment assigned to it becomes unassigned in resolution.' })
  @RequirePermission(Permission.LabLayoutWrite)
  async deleteStation(@Args('id', { type: () => ID }) id: string): Promise<Station> {
    return this.stationService.softDelete(id);
  }

  /**
   * Equipment currently assigned to this station (via InventoryItem.stationId).
   * No permission of its own: the parent Station was authorized by the query above.
   */
  @ResolveField(() => [InventoryItem], { description: 'Equipment assigned to this station.' })
  async equipment(@Parent() station: Station): Promise<InventoryItem[]> {
    return this.inventoryService.findByStationId(String((station as any)._id));
  }
}
