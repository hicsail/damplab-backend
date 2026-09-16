import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Query, Resolver } from '@nestjs/graphql';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { ActivityEvent, ActivityEventEntity, ActivityEventType } from './activity-event.model';
import { ActivityService } from './activity.service';

@Resolver(() => ActivityEvent)
@UseGuards(AuthRolesGuard)
export class ActivityResolver {
  constructor(private readonly activityService: ActivityService) {}

  @Query(() => [ActivityEvent], { description: 'Recent activity events for lab status screens and notifications. Requires labstatustv:view — its only surface is /lab-status-tv.' })
  @RequirePermission(Permission.LabStatusTvView)
  async activityEvents(
    @Args('limit', { type: () => Int, nullable: true }) limit?: number | null,
    @Args('since', { type: () => Date, nullable: true }) since?: Date | null
  ): Promise<ActivityEventEntity[]> {
    return this.activityService.listEvents({ limit, since });
  }

  @Query(() => [ActivityEvent], { description: 'Chronological activity timeline for a single job. Powers the per-job history drawer.' })
  @RequirePermission(Permission.JobsView)
  async jobActivityTimeline(
    @Args('jobId', { type: () => ID }) jobId: string,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number | null,
    @Args('before', { type: () => Date, nullable: true }) before?: Date | null,
    @Args('types', { type: () => [ActivityEventType], nullable: true }) types?: ActivityEventType[] | null
  ): Promise<ActivityEventEntity[]> {
    return this.activityService.listEventsForJob({ jobId, limit, before, types });
  }
}
