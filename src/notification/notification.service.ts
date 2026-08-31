import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { NotificationEntity, NotificationEntityDocument } from './notification.model';
import { NotificationPreferencesEntity, NotificationPreferencesDocument } from './notification-preferences.model';

export interface CreateNotificationInput {
  recipientSub: string;
  recipientEmail?: string;
  eventType: string;
  title: string;
  message: string;
  link?: string;
  jobId?: string;
  sowId?: string;
  actorDisplayName?: string;
  operationId?: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectModel(NotificationEntity.name)
    private readonly notificationModel: Model<NotificationEntityDocument>,
    @InjectModel(NotificationPreferencesEntity.name)
    private readonly preferencesModel: Model<NotificationPreferencesDocument>,
  ) {}

  async create(input: CreateNotificationInput): Promise<NotificationEntity> {
    return this.notificationModel.create({
      recipientSub: input.recipientSub,
      recipientEmail: input.recipientEmail ?? undefined,
      eventType: input.eventType,
      title: input.title,
      message: input.message,
      link: input.link ?? undefined,
      jobId: input.jobId ?? undefined,
      sowId: input.sowId ?? undefined,
      actorDisplayName: input.actorDisplayName ?? undefined,
      operationId: input.operationId ?? undefined,
    });
  }

  async createIdempotent(input: CreateNotificationInput & { operationId: string }): Promise<NotificationEntity> {
    try {
      return await this.create(input);
    } catch (err: any) {
      if (err?.code === 11000) {
        const existing = await this.notificationModel.findOne({ operationId: input.operationId }).exec();
        if (existing) return existing;
      }
      throw err;
    }
  }

  async listForUser(recipientSub: string, limit?: number, offset?: number): Promise<NotificationEntity[]> {
    const l = Math.min(MAX_LIMIT, Math.max(1, limit ?? DEFAULT_LIMIT));
    const s = Math.max(0, offset ?? 0);
    return this.notificationModel
      .find({ recipientSub })
      .sort({ createdAt: -1 })
      .skip(s)
      .limit(l)
      .exec();
  }

  async unreadCount(recipientSub: string): Promise<number> {
    return this.notificationModel.countDocuments({ recipientSub, readAt: null }).exec();
  }

  async markRead(notificationId: string, recipientSub: string): Promise<NotificationEntity | null> {
    return this.notificationModel
      .findOneAndUpdate(
        { _id: notificationId, recipientSub },
        { $set: { readAt: new Date() } },
        { new: true },
      )
      .exec();
  }

  async markAllRead(recipientSub: string): Promise<number> {
    const result = await this.notificationModel
      .updateMany(
        { recipientSub, readAt: null },
        { $set: { readAt: new Date() } },
      )
      .exec();
    return result.modifiedCount;
  }

  async markEmailSent(notificationId: string): Promise<void> {
    await this.notificationModel
      .updateOne({ _id: notificationId }, { $set: { emailSent: true, emailSentAt: new Date() } })
      .exec();
  }

  async getPreferences(userSub: string): Promise<NotificationPreferencesEntity> {
    const doc = await this.preferencesModel.findOne({ userSub }).exec();
    return doc ?? { userSub, emailDisabledEventTypes: [], inAppDisabledEventTypes: [] } as NotificationPreferencesEntity;
  }

  async updatePreferences(
    userSub: string,
    emailDisabledEventTypes?: string[],
    inAppDisabledEventTypes?: string[],
  ): Promise<NotificationPreferencesEntity> {
    const update: Record<string, unknown> = {};
    if (emailDisabledEventTypes !== undefined) update.emailDisabledEventTypes = emailDisabledEventTypes;
    if (inAppDisabledEventTypes !== undefined) update.inAppDisabledEventTypes = inAppDisabledEventTypes;

    const doc = await this.preferencesModel
      .findOneAndUpdate({ userSub }, { $set: update }, { upsert: true, new: true })
      .exec();
    return doc!;
  }
}
