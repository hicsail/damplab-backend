import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';
import { AuthRolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/roles.enum';
import { ActivityEvent, ActivityEventEntity } from './activity-event.model';
import { ActivityService } from './activity.service';

@Resolver(() => ActivityEvent)
@UseGuards(AuthRolesGuard)
export class ActivityResolver {
  constructor(private readonly activityService: ActivityService) {}

  @Query(() => [ActivityEvent], { description: 'Staff-only. Recent activity events for lab status screens and notifications.' })
  @Roles(Role.DamplabStaff)
  async activityEvents(
    @Args('limit', { type: () => Int, nullable: true }) limit?: number | null,
    @Args('since', { type: () => Date, nullable: true }) since?: Date | null
  ): Promise<ActivityEventEntity[]> {
    return this.activityService.listEvents({ limit, since });
  }
}
