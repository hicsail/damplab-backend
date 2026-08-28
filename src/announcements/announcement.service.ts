import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Announcement } from './announcement.model';
import { AnnouncementAudience } from '../audience/audience';
import { CreateAnnouncementInput } from './dto/create-announcement.input';
import { UpdateAnnouncementInput } from './dto/update-announcement.input';

@Injectable()
export class AnnouncementService {
  constructor(
    @InjectModel(Announcement.name)
    private readonly announcementModel: Model<Announcement>
  ) {}

  /**
   * Reject an empty audience list.
   *
   * Validated here rather than with `class-validator` decorators on the input
   * types: this app registers no global `ValidationPipe`, so those decorators
   * would be inert and the rule would silently not exist. Doing it in the service
   * also covers the seed scripts, which talk to Mongo through this layer.
   *
   * The rule matters because absent-or-empty on a *stored* row means "written
   * before audiences existed, show it to everyone". Accepting an empty list on
   * input would make an admin who unchecked every box publish to everybody.
   */
  private assertAudienceNotEmpty(audienceRoles: AnnouncementAudience[] | undefined): void {
    if (audienceRoles !== undefined && audienceRoles.length === 0) {
      throw new BadRequestException('audienceRoles cannot be empty. Omit it to address everyone, or pick at least one audience.');
    }
  }

  async create(input: CreateAnnouncementInput): Promise<Announcement> {
    this.assertAudienceNotEmpty(input.audienceRoles);
    const created = new this.announcementModel({
      ...input,
      timestamp: input.timestamp ?? new Date()
    });
    return created.save();
  }

  /** Everything, newest first. Callers filter by audience; see the resolver. */
  async findAll(): Promise<Announcement[]> {
    return this.announcementModel.find().sort({ timestamp: -1 }).exec();
  }

  /**
   * Everything one caller may see, newest first.
   *
   * Filtered in the query rather than after it: the whole point of threading the
   * caller through is that a technician-only notice must not be readable straight
   * off the endpoint, and post-filtering in the resolver would still have loaded
   * it into memory on behalf of a client.
   *
   * `$exists: false` and `$size: 0` are both "visible to everyone" — the
   * no-migration path for rows written before this field.
   *
   * Hidden rows are excluded here too. `is_displayed` was filtered only in the
   * browser, so every hidden announcement was still shipped over the wire to every
   * reader — the same leak the audience filter exists to prevent, one field over.
   * `allAnnouncements` is where an admin sees hidden rows, and it is gated on
   * `announcements:write`.
   */
  async findForAudiences(audiences: AnnouncementAudience[]): Promise<Announcement[]> {
    return this.announcementModel
      .find({
        is_displayed: true,
        $or: [{ audienceRoles: { $exists: false } }, { audienceRoles: { $size: 0 } }, { audienceRoles: { $in: audiences } }]
      })
      .sort({ timestamp: -1 })
      .exec();
  }

  /**
   * Update one announcement. Accepts an id, or a timestamp for callers written
   * before the type exposed an id.
   */
  async update(input: UpdateAnnouncementInput): Promise<Announcement> {
    this.assertAudienceNotEmpty(input.audienceRoles);
    const announcement = input.id ? await this.announcementModel.findById(input.id) : await this.announcementModel.findOne({ timestamp: input.timestamp });

    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }

    if (input.text !== undefined) announcement.text = input.text;
    if (input.is_displayed !== undefined) announcement.is_displayed = input.is_displayed;
    if (input.audienceRoles !== undefined) announcement.audienceRoles = input.audienceRoles;

    return announcement.save();
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.announcementModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException('Announcement not found');
    }
    return true;
  }
}
