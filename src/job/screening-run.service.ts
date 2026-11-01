import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { HomologyScreeningStatus } from './job.model';
import { ScreeningRun, ScreeningRunAclidLeg, ScreeningRunCustomerLeg, ScreeningRunDocument, ScreeningRunSecureDnaLeg, ScreeningRunSequence, ScreeningRunTrigger } from './screening-run.model';

export interface NewScreeningRun {
  jobId: string;
  trigger: ScreeningRunTrigger;
  triggeredBy: string | null;
  status: HomologyScreeningStatus;
  startedAt: Date;
  sequenceCount: number;
  skippedCount: number;
  sequences: ScreeningRunSequence[];
  fingerprint: string | null;
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
  customer?: ScreeningRunCustomerLeg | null;
  unscreenedNotes?: string[];
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

  /** The customer leg field by field (`customer.<key>`), so a refresh never wipes what it does not know. */
  async updateCustomerLeg(id: string, leg: Partial<ScreeningRunCustomerLeg>): Promise<void> {
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(leg)) set[`customer.${key}`] = value;
    await this.model.updateOne({ _id: id }, { $set: set }).exec();
  }

  /** Newest first, without the raw reports (Aclid's and the customer's) and the per-sequence details: the dropdown needs none. */
  async findForJob(jobId: string): Promise<ScreeningRun[]> {
    if (!mongoose.isValidObjectId(jobId)) return [];
    return this.model.find({ jobId }).select({ 'aclid.raw': 0, 'aclid.details': 0, 'customer.raw': 0 }).sort({ startedAt: -1 }).exec();
  }

  /** The latest run of a job, without the raw reports. */
  async findNewestForJob(jobId: string): Promise<ScreeningRun | null> {
    if (!mongoose.isValidObjectId(jobId)) return null;
    return this.model.findOne({ jobId }).select({ 'aclid.raw': 0, 'aclid.details': 0, 'customer.raw': 0 }).sort({ startedAt: -1 }).exec();
  }

  async findById(id: string): Promise<ScreeningRun | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    return this.model.findById(id).exec();
  }

  async findByAclidScreenId(screenId: string): Promise<ScreeningRun | null> {
    return this.model.findOne({ 'aclid.screenId': screenId }).sort({ startedAt: -1 }).exec();
  }
}
