import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { BugAttachment, BugReport, BugReportDocument } from './bug-report.model';
import { BugReportsFilterInput, CreateBugReportInput } from './bug-report.dto';

@Injectable()
export class BugReportService {
  constructor(@InjectModel(BugReport.name) private readonly bugReportModel: Model<BugReportDocument>) {}

  async create(input: CreateBugReportInput, reporterName?: string | null, reporterEmail?: string | null): Promise<BugReport> {
    const created = new this.bugReportModel({
      description: input.description,
      reporterName: reporterName ?? undefined,
      reporterEmail: reporterEmail ?? undefined,
      createdAt: new Date()
    });
    return created.save();
  }

  async findById(id: string): Promise<BugReport | null> {
    return this.bugReportModel.findById(id).exec();
  }

  async findAll(filter?: BugReportsFilterInput | null): Promise<BugReport[]> {
    const query: FilterQuery<BugReportDocument> = {};

    if (filter?.searchText) {
      query.description = { $regex: filter.searchText, $options: 'i' };
    }

    if (filter?.reporter) {
      const reporterRegex = { $regex: filter.reporter, $options: 'i' };
      query.$or = [{ reporterEmail: reporterRegex }, { reporterName: reporterRegex }];
    }

    return this.bugReportModel.find(query).sort({ createdAt: -1 }).exec();
  }

  async addAttachments(id: string, attachments: BugAttachment[]): Promise<BugReport | null> {
    return this.bugReportModel
      .findByIdAndUpdate(
        id,
        {
          $push: { attachments: { $each: attachments } }
        },
        { new: true }
      )
      .exec();
  }
}

