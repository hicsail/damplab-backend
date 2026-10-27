import { Context, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { calendarFeedOrigin, calendarFeedUrl } from './calendar-feed-url';
import { CalendarFeed } from './calendar-feed.types';
import { CalendarFeedService } from './calendar-feed.service';

@Resolver(() => CalendarFeed)
@UseGuards(AuthRolesGuard)
export class CalendarFeedResolver {
  constructor(private readonly feeds: CalendarFeedService, private readonly config: ConfigService) {}

  private toFeed(token: { token: string; createdAt: Date }, req: any): CalendarFeed {
    const origin = calendarFeedOrigin(this.config.get<string>('calendar.feedBaseUrl'), req);
    return { url: calendarFeedUrl(origin, token.token), createdAt: token.createdAt };
  }

  @Query(() => CalendarFeed, { nullable: true, description: 'The caller’s calendar feed link, or null until they have one. Requires inventory:schedule.' })
  @RequirePermission(Permission.InventorySchedule)
  async calendarFeed(@CurrentUser() user: User, @Context('req') req: any): Promise<CalendarFeed | null> {
    const token = await this.feeds.findForUser(user.sub);
    return token ? this.toFeed(token, req) : null;
  }

  @Mutation(() => CalendarFeed, { description: 'Create the caller’s calendar feed link, or replace it; the old link stops working. Requires inventory:schedule.' })
  @RequirePermission(Permission.InventorySchedule)
  async resetCalendarFeed(@CurrentUser() user: User, @Context('req') req: any): Promise<CalendarFeed> {
    return this.toFeed(await this.feeds.reset(user.sub), req);
  }
}
