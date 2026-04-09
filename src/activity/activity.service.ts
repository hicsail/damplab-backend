import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ActivityEventEntity, ActivityEventEntityDocument } from './activity-event.model';

export interface CreateActivityEventInput {
  type: string;
  message: string;
  actorDisplayName?: string | null;
  jobId?: string | null;
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
      workflowId: input.workflowId ?? undefined,
      workflowNodeId: input.workflowNodeId ?? undefined,
      serviceName: input.serviceName ?? undefined
    });
  }

  async listEvents(input?: { limit?: number | null; since?: Date | null }): Promise<ActivityEventEntity[]> {
    const limit = Math.min(200, Math.max(1, input?.limit ?? 50));
    const since = input?.since ?? null;
    const filter: Record<string, unknown> = since ? { createdAt: { $gte: since } } : {};
    return this.activityModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean().exec();
  }
}

