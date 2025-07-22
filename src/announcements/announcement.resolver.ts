import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { AnnouncementService } from './announcement.service';
import { Announcement } from './announcement.model';
import { CreateAnnouncementInput } from './dto/create-announcement.input';

@Resolver(() => Announcement)
export class AnnouncementResolver {
  constructor(private readonly announcementService: AnnouncementService) {}

  @Query(() => [Announcement])
  async announcements(): Promise<Announcement[]> {
    return this.announcementService.findAll();
  }



  @Mutation(() => Announcement)
  async createAnnouncement(
    @Args('input') input: CreateAnnouncementInput,
  ): Promise<Announcement> {
    return this.announcementService.create(input);
  }
}
