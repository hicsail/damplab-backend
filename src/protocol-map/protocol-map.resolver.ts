import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ProtocolStepMapping } from './protocol-step-mapping.model';
import { ProtocolMapService } from './protocol-map.service';
import {
  ResolvedEquipment,
  ResolvedProtocol,
  ResolvedStation,
  ResolvedStep,
  StepMappingStatus,
  UpsertProtocolStepMappingInput
} from './protocol-map.dto';
import { ProtocolsService } from '../protocols/protocols.service';
import { DampLabServices } from '../services/damplab-services.services';
import { InventoryService } from '../inventory/inventory.service';
import { StationService } from '../station/station.service';
import { AuthRolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/roles.enum';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';

/** Strip HTML tags to a short plain-text label (drift-detection snapshot; NOT protocol content storage). */
function toLabel(html: string, max = 120): string {
  const text = (html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

@Resolver(() => ProtocolStepMapping)
@UseGuards(AuthRolesGuard)
@Roles(Role.DamplabStaff)
export class ProtocolMapResolver {
  constructor(
    private readonly mapService: ProtocolMapService,
    private readonly protocolsService: ProtocolsService,
    private readonly damplabServices: DampLabServices,
    private readonly inventoryService: InventoryService,
    private readonly stationService: StationService
  ) {}

  @Query(() => [ProtocolStepMapping], { description: 'All author-defined step mappings for a protocol.' })
  async protocolStepMappings(@Args('protocolId') protocolId: string): Promise<ProtocolStepMapping[]> {
    return this.mapService.findByProtocol(protocolId);
  }

  @Mutation(() => ProtocolStepMapping, { description: 'Create or update the mapping for one protocol step.' })
  async upsertProtocolStepMapping(
    @Args('input') input: UpsertProtocolStepMappingInput,
    @CurrentUser() user: User
  ): Promise<ProtocolStepMapping> {
    return this.mapService.upsert(input, user?.preferred_username || user?.email);
  }

  @Mutation(() => Boolean, { description: 'Remove the mapping for one protocol step.' })
  async deleteProtocolStepMapping(
    @Args('protocolId') protocolId: string,
    @Args('stepId') stepId: string
  ): Promise<boolean> {
    return this.mapService.remove(protocolId, stepId);
  }

  /**
   * Combined resolver: joins the live protocol (fetched from protocols.io) with the
   * stored step→service→equipment→station references, validating every reference and
   * classifying each step UNMAPPED / MAPPED / BROKEN. This is the query that feeds the
   * technician guidance view and (later) the layout optimizer.
   */
  @Query(() => ResolvedProtocol, { description: 'Resolve a protocol into its full step → service → equipment → station chain with validation.' })
  async resolveProtocol(@Args('protocolId') protocolId: string): Promise<ResolvedProtocol> {
    const [protocol, mappings, services, inventory, stations] = await Promise.all([
      this.protocolsService.getProtocol(protocolId),
      this.mapService.findByProtocol(protocolId),
      this.damplabServices.findAll(),
      this.inventoryService.findAllActive(),
      this.stationService.findAll(false)
    ]);

    const mapByStep = new Map(mappings.map((m) => [m.stepId, m]));
    const svcById = new Map(services.map((s) => [String((s as any)._id ?? (s as any).id), s]));
    const invById = new Map(inventory.map((i) => [String((i as any)._id ?? (i as any).id), i]));
    const stById = new Map(stations.map((s) => [String((s as any)._id), s]));

    let mappedStepCount = 0;

    const steps: ResolvedStep[] = protocol.steps.map((step) => {
      const m = mapByStep.get(step.id);
      const issues: string[] = [];

      // Step → Service
      let service = undefined as ResolvedStep['service'];
      if (m?.serviceId) {
        const svc = svcById.get(String(m.serviceId));
        if (!svc) {
          service = { id: String(m.serviceId), name: undefined, missing: true };
          issues.push('Mapped service no longer exists.');
        } else {
          service = { id: String((svc as any)._id ?? (svc as any).id), name: (svc as any).name, missing: false };
        }
      }

      // Step → Equipment → Station
      const equipment: ResolvedEquipment[] = (m?.equipmentIds ?? []).map((eid) => {
        const item = invById.get(String(eid));
        if (!item) {
          issues.push('A required piece of equipment no longer exists.');
          return { id: String(eid), name: undefined, missing: true, station: undefined };
        }
        let station = undefined as ResolvedStation | undefined;
        const stationId = (item as any).stationId;
        if (stationId) {
          const st = stById.get(String(stationId));
          if (!st) {
            issues.push(`Equipment "${(item as any).name}" is assigned to a station that no longer exists.`);
          } else {
            station = {
              id: String((st as any)._id),
              name: (st as any).name,
              type: (st as any).type,
              zone: (st as any).zone,
              x: (st as any).x,
              y: (st as any).y
            };
          }
        } else {
          issues.push(`Equipment "${(item as any).name}" is not assigned to a station.`);
        }
        return { id: String((item as any)._id ?? (item as any).id), name: (item as any).name, missing: false, station };
      });

      const requiresNoEquipment = !!m?.requiresNoEquipment;
      const hasEquipment = equipment.length > 0;

      // Classify the step.
      const touched = !!m && (!!m.serviceId || hasEquipment || requiresNoEquipment || m.reviewed);
      let status: StepMappingStatus;
      if (!touched) {
        status = StepMappingStatus.UNMAPPED;
      } else if (issues.length > 0) {
        status = StepMappingStatus.BROKEN;
      } else if (!m!.serviceId) {
        // Reviewed but no service chosen yet — still incomplete.
        status = StepMappingStatus.UNMAPPED;
      } else if (!hasEquipment && !requiresNoEquipment) {
        // A service is chosen but equipment hasn't been decided (neither assigned nor explicitly "none").
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
        service,
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
