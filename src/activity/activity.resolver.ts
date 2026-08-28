import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { ActivityEvent, ActivityEventEntity } from './activity-event.model';
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
}
