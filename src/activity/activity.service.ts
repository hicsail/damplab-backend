import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ActivityEventEntity, ActivityEventEntityDocument, ActivityEventType } from './activity-event.model';

export interface CreateActivityEventInput {
  type: ActivityEventType;
  message: string;
  actorDisplayName?: string | null;
  jobId?: string | null;
  jobVersionNumber?: number | null;
  sowId?: string | null;
  sowVersionNumber?: number | null;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
  commentId?: string | null;
  operationId?: string | null;
  workflowId?: string | null;
  workflowNodeId?: string | null;
  serviceName?: string | null;
  createdAt?: Date;
}

@Injectable()
export class ActivityService {
  constructor(
    @InjectModel(ActivityEventEntity.name)
    private readonly activityModel: Model<ActivityEventEntityDocument>
  ) {}

  async createEvent(input: CreateActivityEventInput): Promise<ActivityEventEntity> {
    return this.activityModel.create({
      createdAt: input.createdAt ?? new Date(),
      type: input.type,
      message: input.message,
      actorDisplayName: input.actorDisplayName ?? undefined,
      jobId: input.jobId ?? undefined,
      jobVersionNumber: input.jobVersionNumber ?? undefined,
      sowId: input.sowId ?? undefined,
      sowVersionNumber: input.sowVersionNumber ?? undefined,
      invoiceId: input.invoiceId ?? undefined,
      invoiceNumber: input.invoiceNumber ?? undefined,
      commentId: input.commentId ?? undefined,
      operationId: input.operationId ?? undefined,
      workflowId: input.workflowId ?? undefined,
      workflowNodeId: input.workflowNodeId ?? undefined,
      serviceName: input.serviceName ?? undefined
    });
  }

  async createEventIdempotent(input: CreateActivityEventInput & { operationId: string }): Promise<ActivityEventEntity> {
    try {
      return await this.createEvent(input);
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      const raced = await this.activityModel.findOne({ operationId: input.operationId }).exec();
      if (!raced) throw error;
      return raced;
    }
  }

  async listEvents(input?: { limit?: number | null; since?: Date | null }): Promise<ActivityEventEntity[]> {
    const limit = Math.min(200, Math.max(1, input?.limit ?? 50));
    const since = input?.since ?? null;
    const filter: Record<string, unknown> = since ? { createdAt: { $gte: since } } : {};
    return this.activityModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean().exec();
  }

  async listEventsForJob(input: {
    jobId: string;
    limit?: number | null;
    before?: Date | null;
    types?: ActivityEventType[] | null;
  }): Promise<ActivityEventEntity[]> {
    const limit = Math.min(200, Math.max(1, input.limit ?? 50));
    const filter: Record<string, unknown> = { jobId: input.jobId };
    if (input.before) filter.createdAt = { $lt: input.before };
    if (input.types?.length) filter.type = { $in: input.types };
    return this.activityModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean().exec();
  }
}
