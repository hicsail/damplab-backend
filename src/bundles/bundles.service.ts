import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Bundle } from './bundles.model';
import { Model } from 'mongoose';
import { BundleChange } from './dtos/update.dto';
import { CreateBundle } from './dtos/create.dto';

@Injectable()
export class BundlesService {
  constructor(@InjectModel(Bundle.name) private readonly bundleModel: Model<Bundle>) {}

  async find(id: string): Promise<Bundle | null> {
    return this.bundleModel.findById(id);
  }

  async findAll(): Promise<Bundle[]> {
    return this.bundleModel.find().exec();
  }

  async create(bundle: CreateBundle): Promise<Bundle> {
    return this.bundleModel.create(bundle);
  }

  async update(bundle: Bundle, changes: BundleChange): Promise<Bundle> {
    await this.bundleModel.updateOne({ _id: bundle.id }, changes);
    return (await this.find(bundle.id))!;
  }

  async delete(bundle: Bundle): Promise<void> {
    await this.bundleModel.deleteOne({ _id: bundle.id });
  }
}
