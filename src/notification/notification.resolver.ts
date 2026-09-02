import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { NotificationService } from './notification.service';
import { Notification, NotificationPage } from './notification.model';
import { NotificationPreferences, UpdateNotificationPreferencesInput } from './notification-preferences.model';

@Resolver(() => Notification)
@UseGuards(AuthRolesGuard)
export class NotificationResolver {
  constructor(private readonly notificationService: NotificationService) {}

  @Query(() => NotificationPage, { description: 'Paginated notifications for the current user.' })
  async myNotifications(
    @CurrentUser() user: User,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
    @Args('offset', { type: () => Int, nullable: true }) offset?: number
  ): Promise<NotificationPage> {
    const [items, unreadCount] = await Promise.all([this.notificationService.listForUser(user.sub, limit, offset), this.notificationService.unreadCount(user.sub)]);
    return { items: items as any[], unreadCount };
  }

  @Query(() => Int, { description: 'Number of unread notifications for the current user.' })
  async myUnreadNotificationCount(@CurrentUser() user: User): Promise<number> {
    return this.notificationService.unreadCount(user.sub);
  }

  @Query(() => NotificationPreferences, { description: 'Notification preferences for the current user.' })
  async myNotificationPreferences(@CurrentUser() user: User): Promise<NotificationPreferences> {
    return this.notificationService.getPreferences(user.sub);
  }

  @Mutation(() => Notification, { nullable: true, description: 'Mark a single notification as read.' })
  async markNotificationRead(@CurrentUser() user: User, @Args('id', { type: () => ID }) id: string): Promise<Notification | null> {
    return this.notificationService.markRead(id, user.sub) as any;
  }

  @Mutation(() => Int, { description: 'Mark all notifications as read. Returns the count marked.' })
  async markAllNotificationsRead(@CurrentUser() user: User): Promise<number> {
    return this.notificationService.markAllRead(user.sub);
  }

  @Mutation(() => NotificationPreferences, { description: 'Update notification preferences.' })
  async updateNotificationPreferences(@CurrentUser() user: User, @Args('input') input: UpdateNotificationPreferencesInput): Promise<NotificationPreferences> {
    return this.notificationService.updatePreferences(user.sub, input.emailDisabledEventTypes, input.inAppDisabledEventTypes);
  }
}
