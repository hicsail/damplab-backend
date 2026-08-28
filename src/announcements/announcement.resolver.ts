import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AnnouncementService } from './announcement.service';
import { Announcement } from './announcement.model';
import { audiencesFor } from '../audience/audience';
import { CreateAnnouncementInput } from './dto/create-announcement.input';
import { UpdateAnnouncementInput } from './dto/update-announcement.input';

import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';

@Resolver(() => Announcement)
@UseGuards(AuthRolesGuard)
export class AnnouncementResolver {
  constructor(private readonly announcementService: AnnouncementService) {}

  /**
   * Announcements the caller may see.
   *
   * This query took no arguments, had no `@Roles`, and never injected the caller —
   * the server did not know who was asking, so audience targeting done in the
   * browser would have left a tech-only "lab inspection" notice readable straight
   * off the endpoint. Threading the caller in is the substance of the change.
   *
   * Still open to every authenticated user: `announcements:read` is baseline. What
   * narrows is the *rows*, not the access.
   *
   * **Known wart, stated rather than filed:** Client View is a UI illusion — the
   * real token is unchanged — so a staff user toggled to Client View still receives
   * staff-visible announcements from the server. That is consistent with every
   * other Client View behaviour.
   */
  @Query(() => [Announcement], { description: 'Announcements addressed to an audience the caller belongs to, newest first. Rows with no audience are visible to everyone.' })
  @RequirePermission(Permission.AnnouncementsRead)
  async announcements(@CurrentUser() user: User): Promise<Announcement[]> {
    return this.announcementService.findForAudiences(audiencesFor(user));
  }

  /** Every announcement regardless of audience — the admin table. */
  @Query(() => [Announcement], { description: 'Every announcement, for the admin editor. Requires announcements:write.' })
  @RequirePermission(Permission.AnnouncementsWrite)
  async allAnnouncements(): Promise<Announcement[]> {
    return this.announcementService.findAll();
  }

  @Mutation(() => Announcement)
  @RequirePermission(Permission.AnnouncementsWrite)
  async createAnnouncement(@Args('input') input: CreateAnnouncementInput): Promise<Announcement> {
    return this.announcementService.create(input);
  }

  @Mutation(() => Announcement, { description: 'Edit an announcement: its text, its visibility, or its audience.' })
  @RequirePermission(Permission.AnnouncementsWrite)
  async updateAnnouncement(@Args('input') input: UpdateAnnouncementInput): Promise<Announcement> {
    return this.announcementService.update(input);
  }

  @Mutation(() => Boolean, { description: 'Delete an announcement outright. Hiding one (is_displayed: false) is usually what you want instead.' })
  @RequirePermission(Permission.AnnouncementsWrite)
  async deleteAnnouncement(@Args('id', { type: () => ID }) id: string): Promise<boolean> {
    return this.announcementService.delete(id);
  }
}
