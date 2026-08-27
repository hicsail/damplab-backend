import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ProtocolStepMapping } from './protocol-step-mapping.model';
import { ProtocolMapService } from './protocol-map.service';
import { ResolvedEquipment, ResolvedPlacement, ResolvedProtocol, ResolvedStep, StepMappingStatus, UpsertProtocolStepMappingInput } from './protocol-map.dto';
import { ProtocolsService } from '../protocols/protocols.service';
import { InventoryService } from '../inventory/inventory.service';
import { StationService } from '../station/station.service';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';

/** Strip HTML tags to a short plain-text label (drift-detection snapshot; NOT protocol content storage). */
function toLabel(html: string, max = 120): string {
  const text = (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The class-level `@Roles(Role.DamplabStaff)` this replaces covered the read
 * queries too, so `/protocol-map` 403'd on load for a `protocol-library:read`
 * holder. Read and write are split per the matrix — which gives technicians
 * write here, unlike the catalog and the lab layout.
 */
@Resolver(() => ProtocolStepMapping)
@UseGuards(AuthRolesGuard)
export class ProtocolMapResolver {
  constructor(
    private readonly mapService: ProtocolMapService,
    private readonly protocolsService: ProtocolsService,
    private readonly inventoryService: InventoryService,
    private readonly stationService: StationService
  ) {}

  @Query(() => [ProtocolStepMapping], { description: 'All author-defined step mappings for a protocol.' })
  @RequirePermission(Permission.ProtocolLibraryRead)
  async protocolStepMappings(@Args('protocolId') protocolId: string): Promise<ProtocolStepMapping[]> {
    return this.mapService.findByProtocol(protocolId);
  }

  @Mutation(() => ProtocolStepMapping, { description: 'Create or update the mapping for one protocol step.' })
  @RequirePermission(Permission.ProtocolLibraryWrite)
  async upsertProtocolStepMapping(@Args('input') input: UpsertProtocolStepMappingInput, @CurrentUser() user: User): Promise<ProtocolStepMapping> {
    return this.mapService.upsert(input, user?.preferred_username || user?.email);
  }

  @Mutation(() => Boolean, { description: 'Remove the mapping for one protocol step.' })
  @RequirePermission(Permission.ProtocolLibraryWrite)
  async deleteProtocolStepMapping(@Args('protocolId') protocolId: string, @Args('stepId') stepId: string): Promise<boolean> {
    return this.mapService.remove(protocolId, stepId);
  }

  /**
   * Combined resolver: joins the live protocol (fetched from protocols.io, already
   * sorted into execution order) with the stored step→equipment references,
   * resolving each item to every station it is placed at, validating every
   * reference and classifying each step UNMAPPED / MAPPED / BROKEN. Feeds the
   * technician guidance view and (later) the layout optimizer.
   *
   * There is no per-step service: the operation↔protocol link lives on
   * DampLabService.protocolIds, so a step is "mapped" purely on equipment.
   */
  @Query(() => ResolvedProtocol, { description: 'Resolve a protocol into its full step → equipment → station chain with validation. Steps come back in execution order.' })
  @RequirePermission(Permission.ProtocolLibraryRead)
  async resolveProtocol(@Args('protocolId') protocolId: string): Promise<ResolvedProtocol> {
    const [protocol, mappings, inventory, stations] = await Promise.all([
      this.protocolsService.getProtocol(protocolId),
      this.mapService.findByProtocol(protocolId),
      this.inventoryService.findAllActive(),
      this.stationService.findAll(false)
    ]);

    const mapByStep = new Map(mappings.map((m) => [m.stepId, m]));
    const invById = new Map(inventory.map((i) => [String((i as any)._id ?? (i as any).id), i]));
    const stById = new Map(stations.map((s) => [String((s as any)._id), s]));

    let mappedStepCount = 0;

    const steps: ResolvedStep[] = protocol.steps.map((step) => {
      const m = mapByStep.get(step.id);
      const issues: string[] = [];

      // Step → Equipment → Station(s)
      const equipment: ResolvedEquipment[] = (m?.equipmentIds ?? []).map((eid) => {
        const item = invById.get(String(eid));
        if (!item) {
          issues.push('A required piece of equipment no longer exists.');
          return { id: String(eid), name: undefined, missing: true, placements: [] };
        }
        const name = (item as any).name;
        const raw = Array.isArray((item as any).placements) ? (item as any).placements : [];
        const placements: ResolvedPlacement[] = [];
        for (const p of raw) {
          const st = stById.get(String(p?.stationId));
          if (!st) {
            // A dangling placement is worth surfacing, but the remaining valid
            // placements still stand — don't discard the whole item.
            issues.push(`Equipment "${name}" is placed at a station that no longer exists.`);
            continue;
          }
          placements.push({
            station: {
              id: String((st as any)._id),
              name: (st as any).name,
              type: (st as any).type,
              zone: (st as any).zone,
              x: (st as any).x,
              y: (st as any).y
            },
            quantity: Math.max(1, Math.trunc(Number(p?.quantity) || 1))
          });
        }
        if (placements.length === 0 && raw.length === 0) {
          issues.push(`Equipment "${name}" is not placed at any station.`);
        }
        return { id: String((item as any)._id ?? (item as any).id), name, missing: false, placements };
      });

      const requiresNoEquipment = !!m?.requiresNoEquipment;
      const hasEquipment = equipment.length > 0;

      // Classify the step. Equipment is the only criterion now.
      const touched = !!m && (hasEquipment || requiresNoEquipment || m.reviewed);
      let status: StepMappingStatus;
      if (!touched) {
        status = StepMappingStatus.UNMAPPED;
      } else if (issues.length > 0) {
        status = StepMappingStatus.BROKEN;
      } else if (!hasEquipment && !requiresNoEquipment) {
        // Reviewed, but equipment hasn't been decided (neither assigned nor explicitly "none").
        status = StepMappingStatus.UNMAPPED;
      } else {
        status = StepMappingStatus.MAPPED;
      }

      if (status === StepMappingStatus.MAPPED) mappedStepCount += 1;

      return {
        stepId: step.id,
        number: step.number || undefined,
        title: m?.stepTitle || toLabel(step.html),
        status,
        equipment,
        requiresNoEquipment,
        issues
      };
    });

    const totalStepCount = steps.length;
    const fullyMapped = totalStepCount > 0 && steps.every((s) => s.status === StepMappingStatus.MAPPED);

    return {
      protocolId,
      title: protocol.title,
      fullyMapped,
      totalStepCount,
      mappedStepCount,
      steps
    };
  }
}
