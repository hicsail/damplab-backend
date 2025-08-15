import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Bundle } from './bundles.model';
import { Model } from 'mongoose';
import { BundleChange } from './dtos/update.dto';
import { CreateBundleInput } from './dtos/create.dto';

@Injectable()
export class BundlesService {
  constructor(@InjectModel(Bundle.name) private readonly bundleModel: Model<Bundle>) {}

  async find(id: string): Promise<Bundle | null> {
    return this.bundleModel.findById(id);
  }

  async findAll(): Promise<Bundle[]> {
    return this.bundleModel.find().exec();
  }

  async create(bundle: CreateBundleInput): Promise<Bundle>{
    return this.bundleModel.create(bundle);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.bundleModel.deleteOne({ _id: id });
    return result.deletedCount > 0;
  };

  async update(bundle: Bundle, changes: BundleChange): Promise<Bundle> {
    await this.bundleModel.updateOne({ _id: bundle.id }, changes);
    return (await this.find(bundle.id))!;
  }
}
