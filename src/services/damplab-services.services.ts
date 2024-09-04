import { Injectable } from '@nestjs/common';
import { DampLabService, DampLabServiceDocument } from './models/damplab-service.model';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { ServiceChange } from './dtos/update.dto';

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

  async findOne(id: string): Promise<DampLabService | null> {
    return this.dampLabServiceModel.findById(id).exec();
  }

  async update(service: DampLabService, changes: ServiceChange): Promise<DampLabService> {
    await this.dampLabServiceModel.updateOne({ _id: service._id }, changes);
    return (await this.dampLabServiceModel.findById(service._id))!;
  }
}
