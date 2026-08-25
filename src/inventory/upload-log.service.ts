import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UploadLog } from './upload-log.model';

@Injectable()
export class UploadLogService {
  constructor(@InjectModel(UploadLog.name) private readonly model: Model<UploadLog>) {}

  async create(input: Partial<UploadLog>): Promise<UploadLog> {
    return this.model.create(input);
  }

  async findAll(): Promise<UploadLog[]> {
    return this.model.find().sort({ uploadDate: -1 }).exec();
  }

  async findById(id: string): Promise<UploadLog | null> {
    return this.model.findById(id).exec();
  }
}
