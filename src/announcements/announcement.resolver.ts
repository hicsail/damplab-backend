import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AnnouncementService } from './announcement.service';
import { Announcement } from './announcement.model';
import { CreateAnnouncementInput } from './dto/create-announcement.input';
import { UpdateAnnouncementInput } from './dto/update-announcement.input';

import { Roles } from '../auth/roles/roles.decorator';
import { Role } from '../auth/roles/roles.enum';
import { AuthRolesGuard } from 'src/auth/auth.guard';

@Resolver(() => Announcement)
export class AnnouncementResolver {
  constructor(private readonly announcementService: AnnouncementService) {}

  @Query(() => [Announcement])
  async announcements(): Promise<Announcement[]> {
    return this.announcementService.findAll();
  }

  @Mutation(() => Announcement)
  @UseGuards(AuthRolesGuard)
  @Roles(Role.DamplabStaff)
  async createAnnouncement(@Args('input') input: CreateAnnouncementInput): Promise<Announcement> {
    return this.announcementService.create(input);
  }

  @Mutation(() => Announcement)
  @UseGuards(AuthRolesGuard)
  @Roles(Role.DamplabStaff)
  async updateAnnouncement(@Args('input') input: UpdateAnnouncementInput): Promise<Announcement> {
    return this.announcementService.updateByTimestamp(input);
  }
}
