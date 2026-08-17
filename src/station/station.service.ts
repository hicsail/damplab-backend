import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Station, StationDocument } from './station.model';
import { CreateStationInput, UpdateStationInput } from './station.dto';

@Injectable()
export class StationService {
  constructor(@InjectModel(Station.name) private readonly model: Model<StationDocument>) {}

  async create(input: CreateStationInput): Promise<Station> {
    return this.model.create({ ...input, isDeleted: false });
  }

  async findAll(includeDeleted = false): Promise<Station[]> {
    return this.model
      .find(includeDeleted ? {} : { isDeleted: { $ne: true } })
      .sort({ name: 1 })
      .exec();
  }

  async findById(id: string): Promise<Station | null> {
    return this.model.findById(id).exec();
  }

  async findByIds(ids: string[]): Promise<Station[]> {
    return this.model.find({ _id: { $in: ids } }).exec();
  }

  async update(input: UpdateStationInput): Promise<Station> {
    const { id, ...rest } = input;
    const set: Record<string, unknown> = {};
    Object.entries(rest).forEach(([k, v]) => {
      if (v !== undefined) set[k] = v;
    });
    const updated = await this.model.findByIdAndUpdate(id, { $set: set }, { new: true }).exec();
    if (!updated) throw new NotFoundException('Station not found.');
    return updated;
  }

  async softDelete(id: string): Promise<Station> {
    const updated = await this.model.findByIdAndUpdate(id, { $set: { isDeleted: true } }, { new: true }).exec();
    if (!updated) throw new NotFoundException('Station not found.');
    return updated;
  }
}
