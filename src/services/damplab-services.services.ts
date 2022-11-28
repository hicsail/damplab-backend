import { Injectable } from '@nestjs/common';
import { DampLabService, DampLabServiceDocument } from './models/damplab-service.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';

@Injectable()
export class DampLabServices {
  constructor(@InjectModel(DampLabService.name) private readonly dampLabServiceModel: Model<DampLabServiceDocument>) {}

  findAll(): Promise<DampLabService[]> {
    return this.dampLabServiceModel.find().exec();
  }

  /**
   * Find a list of services by their IDs.
   */
  async findByIds(ids: mongoose.Types.ObjectId[]): Promise<DampLabService[]> {
    return this.dampLabServiceModel.find({ _id: { $in: ids } }).exec();
  }
}
