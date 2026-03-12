import { UseGuards } from '@nestjs/common';
import { WorkflowNode, WorkflowNodeState } from '../models/node.model';
import { Parent, Resolver, ResolveField, Mutation, Query, ID, Args, Float } from '@nestjs/graphql';
import { DampLabServices } from '../../services/damplab-services.services';
import { DampLabService } from '../../services/models/damplab-service.model';
import mongoose from 'mongoose';
import { WorkflowNodePipe } from '../node.pipe';
import { WorkflowNodeService } from '../services/node.service';
import { WorkflowService } from '../workflow.service';
import { Workflow } from '../models/workflow.model';
import { getMultiValueParamIds, normalizeFormDataToArray, FormDataEntry } from '../utils/form-data.util';
import JSON from 'graphql-type-json';
import { AuthRolesGuard } from '../../auth/auth.guard';
import { Roles } from '../../auth/roles/roles.decorator';
import { Role } from '../../auth/roles/roles.enum';
import { LabMonitorStaffMember } from '../dtos/lab-monitor-staff.dto';
import { KeycloakService } from '../../keycloak/keycloak.service';

@Resolver(() => WorkflowNode)
export class WorkflowNodeResolver {
  constructor(
    private readonly damplabServices: DampLabServices,
    private readonly nodeService: WorkflowNodeService,
    private readonly workflowService: WorkflowService,
    private readonly keycloakService: KeycloakService
  ) {}

  @Mutation(() => WorkflowNode)
  @UseGuards(AuthRolesGuard)
  @Roles(Role.DamplabStaff)
  async changeWorkflowNodeState(
    @Args('workflowNode', { type: () => ID }, WorkflowNodePipe) workflowNode: WorkflowNode,
    @Args('newState', { type: () => WorkflowNodeState }) newState: WorkflowNodeState
  ): Promise<WorkflowNode> {
    return (await this.nodeService.updateState(workflowNode, newState))!;
  }

  @Mutation(() => WorkflowNode)
  @UseGuards(AuthRolesGuard)
  @Roles(Role.DamplabStaff)
  async updateWorkflowNodeAssignee(
    @Args('workflowNode', { type: () => ID }, WorkflowNodePipe) workflowNode: WorkflowNode,
    @Args('assigneeId', { type: () => String, nullable: true }) assigneeId: string | null,
    @Args('assigneeDisplayName', { type: () => String, nullable: true }) assigneeDisplayName: string | null
  ): Promise<WorkflowNode> {
    return (await this.nodeService.updateAssignee(workflowNode, assigneeId, assigneeDisplayName))!;
  }

  @Mutation(() => WorkflowNode)
  @UseGuards(AuthRolesGuard)
  @Roles(Role.DamplabStaff)
  async updateWorkflowNodeEstimatedTime(
    @Args('workflowNode', { type: () => ID }, WorkflowNodePipe) workflowNode: WorkflowNode,
    @Args('estimatedMinutes', { type: () => Float, nullable: true }) estimatedMinutes: number | null
  ): Promise<WorkflowNode> {
    return (await this.nodeService.updateEstimatedMinutes(workflowNode, estimatedMinutes))!;
  }

  @Query(() => [WorkflowNode], {
    description: 'Nodes in this state that belong to approved-job workflows (lab monitor columns by node state).'
  })
  @UseGuards(AuthRolesGuard)
  @Roles(Role.DamplabStaff)
  async getLabMonitorNodes(@Args('nodeState', { type: () => WorkflowNodeState }) nodeState: WorkflowNodeState): Promise<WorkflowNode[]> {
    return this.nodeService.getNodesByStateForApprovedJobs(nodeState);
  }

  @Query(() => [LabMonitorStaffMember], {
    description: 'Staff members available for assignment on lab monitor cards. Sourced from Keycloak group (damplab-staff) when configured, else LAB_MONITOR_STAFF env.'
  })
  @UseGuards(AuthRolesGuard)
  @Roles(Role.DamplabStaff)
  async getLabMonitorStaffList(): Promise<LabMonitorStaffMember[]> {
    if (this.keycloakService.isConfigured()) {
      return this.keycloakService.getLabStaffGroupMembers();
    }
    const raw = process.env.LAB_MONITOR_STAFF;
    if (!raw || typeof raw !== 'string') return [];
    try {
      const parsed = globalThis.JSON.parse(raw) as Array<{ id: string; displayName: string }>;
      return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x.id === 'string' && typeof x.displayName === 'string') : [];
    } catch {
      return [];
    }
  }

  @ResolveField(() => Workflow, { nullable: true, description: 'Parent workflow containing this node' })
  async workflow(@Parent() node: WorkflowNode): Promise<Workflow | null> {
    return this.workflowService.findWhereNodeId(node._id);
  }

  @ResolveField()
  async service(@Parent() node: WorkflowNode): Promise<DampLabService> {
    if (node.service instanceof mongoose.Types.ObjectId) {
      const service = await this.damplabServices.findOne(node.service.toString());
      if (service !== null) {
        return service;
      } else {
        throw new Error(`Could not find service with ID ${node.service}`);
      }
    } else {
      return node.service as DampLabService;
    }
  }

  /**
   * Returns formData as a canonical array of { id, value }. Multi-value parameters have value: string[].
   * Converts legacy object-shaped formData when present in the DB.
   */
  @ResolveField(() => JSON)
  async formData(@Parent() node: WorkflowNode): Promise<FormDataEntry[]> {
    const service = node.service instanceof mongoose.Types.ObjectId ? await this.damplabServices.findOne(node.service.toString()) : (node.service as DampLabService);
    const multiValueParamIds = service?.parameters ? getMultiValueParamIds(service.parameters) : new Set<string>();
    return normalizeFormDataToArray(node.formData, multiValueParamIds);
  }
}
