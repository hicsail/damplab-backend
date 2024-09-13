import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Bundle } from './bundles.model';
import { Model } from 'mongoose';
import { BundleChange } from './dtos/update.dto';

@Injectable()
export class BundlesService {
  constructor(@InjectModel(Bundle.name) private readonly bundleModel: Model<Bundle>) {}

  async find(id: string): Promise<Bundle | null> {
    return this.bundleModel.findById(id);
  }

  async findAll(): Promise<Bundle[]> {
    return this.bundleModel.find().exec();
  }

  async update(bundle: Bundle, changes: BundleChange): Promise<Bundle> {
    await this.bundleModel.updateOne({ _id: bundle.id }, changes);
    return (await this.find(bundle.id))!;
  }
}
