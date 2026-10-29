import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { HomologyScreeningStatus } from './job.model';
import { ScreeningRun, ScreeningRunAclidLeg, ScreeningRunDocument, ScreeningRunSecureDnaLeg, ScreeningRunSequence, ScreeningRunTrigger } from './screening-run.model';

export interface NewScreeningRun {
  jobId: string;
  trigger: ScreeningRunTrigger;
  triggeredBy: string | null;
  status: HomologyScreeningStatus;
  startedAt: Date;
  sequenceCount: number;
  skippedCount: number;
  sequences: ScreeningRunSequence[];
}

export interface ScreeningRunPatch {
  status?: HomologyScreeningStatus;
  completedAt?: Date | null;
  sequenceCount?: number;
  skippedCount?: number;
  detail?: string | null;
  sequences?: ScreeningRunSequence[];
  aclid?: ScreeningRunAclidLeg | null;
  secureDna?: ScreeningRunSecureDnaLeg | null;
}

/** Storage for `screening_runs`. Writes come from JobScreeningService; reads from ScreeningRunResolver. */
@Injectable()
export class ScreeningRunService {
  constructor(@InjectModel(ScreeningRun.name) private readonly model: Model<ScreeningRunDocument>) {}

  async create(run: NewScreeningRun): Promise<string> {
    const created = await this.model.create(run);
    return String(created._id);
  }

  async update(id: string, patch: ScreeningRunPatch): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: patch }).exec();
  }

  /** The leg field by field (`aclid.<key>`), so a refresh never wipes what it does not know. */
  async updateAclidLeg(id: string, leg: Partial<ScreeningRunAclidLeg>, patch: ScreeningRunPatch = {}): Promise<void> {
    const set: Record<string, unknown> = { ...patch };
    for (const [key, value] of Object.entries(leg)) set[`aclid.${key}`] = value;
    await this.model.updateOne({ _id: id }, { $set: set }).exec();
  }

  /** Newest first, without the raw report and the per-sequence details: the dropdown needs neither. */
  async findForJob(jobId: string): Promise<ScreeningRun[]> {
    if (!mongoose.isValidObjectId(jobId)) return [];
    return this.model.find({ jobId }).select({ 'aclid.raw': 0, 'aclid.details': 0 }).sort({ startedAt: -1 }).exec();
  }

  async findById(id: string): Promise<ScreeningRun | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    return this.model.findById(id).exec();
  }

  async findByAclidScreenId(screenId: string): Promise<ScreeningRun | null> {
    return this.model.findOne({ 'aclid.screenId': screenId }).sort({ startedAt: -1 }).exec();
  }
}
