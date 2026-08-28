import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { TrainingResource, TrainingResourceDocument } from './training-resource.model';
import { CreateTrainingResourceInput, TrainingFileInput, UpdateTrainingResourceInput } from './dto/training-resource.input';
import { AnnouncementAudience } from '../audience/audience';

@Injectable()
export class TrainingService {
  constructor(
    @InjectModel(TrainingResource.name)
    private readonly resourceModel: Model<TrainingResourceDocument>
  ) {}

  /**
   * An empty audience is an error, not "everyone".
   *
   * Enforced in the service rather than by `class-validator`, because the app
   * registers no global `ValidationPipe` — the same reason the announcement service
   * checks it here. The input type only documents the rule; GraphQL itself would
   * accept `[]`.
   */
  private assertAudienceNotEmpty(audienceRoles: AnnouncementAudience[] | undefined): void {
    if (audienceRoles !== undefined && audienceRoles.length === 0) {
      throw new BadRequestException('audienceRoles cannot be empty. Pick at least one group that may see this document.');
    }
  }

  /**
   * The documents a caller may see, newest first.
   *
   * Filtered in the query rather than after it. Post-filtering would still have
   * loaded another audience's document into memory on this caller's behalf, and this
   * field is authorization here, not presentation — the audience decides who may
   * download a file.
   *
   * There is deliberately **no** absent-or-empty escape hatch, unlike announcements:
   * this field is required, so a document with no audience cannot exist and a bug
   * that produced one would hide it rather than show it to everybody.
   */
  async findForAudiences(audiences: AnnouncementAudience[]): Promise<TrainingResource[]> {
    return this.resourceModel
      .find({ audienceRoles: { $in: audiences } })
      .sort({ createdAt: -1 })
      .exec();
  }

  /** Every document, for the administrator's list. Requires `training:write`. */
  async findAll(): Promise<TrainingResource[]> {
    return this.resourceModel.find().sort({ createdAt: -1 }).exec();
  }

  /**
   * One document, only if the caller is in its audience.
   *
   * The audience check lives here rather than in the resolver so that no caller of
   * this method can forget it — this is the method the download path goes through,
   * and a presigned URL handed out by mistake cannot be recalled.
   */
  async findOneForAudiences(id: string, audiences: AnnouncementAudience[]): Promise<TrainingResource | null> {
    return this.resourceModel.findOne({ _id: id, audienceRoles: { $in: audiences } }).exec();
  }

  async findById(id: string): Promise<TrainingResource | null> {
    return this.resourceModel.findById(id).exec();
  }

  async create(input: CreateTrainingResourceInput, updatedBy?: string): Promise<TrainingResource> {
    this.assertAudienceNotEmpty(input.audienceRoles);
    if (!input.audienceRoles?.length) {
      throw new BadRequestException('Pick at least one group that may see this document.');
    }
    return this.resourceModel.create({
      title: input.title,
      description: input.description ?? '',
      audienceRoles: input.audienceRoles,
      updatedBy
    });
  }

  async update(input: UpdateTrainingResourceInput, updatedBy?: string): Promise<TrainingResource> {
    this.assertAudienceNotEmpty(input.audienceRoles);
    const resource = await this.resourceModel.findById(input.id);
    if (!resource) throw new NotFoundException('Document not found');

    if (input.title !== undefined) resource.title = input.title;
    if (input.description !== undefined) resource.description = input.description;
    if (input.audienceRoles !== undefined) resource.audienceRoles = input.audienceRoles;
    resource.updatedBy = updatedBy;
    return resource.save();
  }

  /** Attach the uploaded file to the record, once the browser's PUT to S3 succeeded. */
  async attachFile(id: string, file: TrainingFileInput, updatedBy?: string): Promise<TrainingResource> {
    const resource = await this.resourceModel.findById(id);
    if (!resource) throw new NotFoundException('Document not found');
    resource.file = file;
    resource.updatedBy = updatedBy;
    return resource.save();
  }

  /**
   * Delete the record.
   *
   * The S3 object is left behind. Deliberate: the bucket has no lifecycle policy
   * wired up here, and an orphaned object under a uuid key is unreachable without
   * the record that names it — cheaper than a delete that can half-fail.
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.resourceModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException('Document not found');
    return true;
  }
}
