import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Announcement, AnnouncementSchema } from './announcement.model';
import { AnnouncementService } from './announcement.service';
import { AnnouncementResolver } from './announcement.resolver';

@Module({
  imports: [MongooseModule.forFeature([{ name: Announcement.name, schema: AnnouncementSchema }])],
  providers: [AnnouncementService, AnnouncementResolver]
})
export class AnnouncementModule {}
