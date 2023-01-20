import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Bundle } from './bundles.model';
import { Model } from 'mongoose';

@Injectable()
export class BundlesService {
  constructor(@InjectModel(Bundle.name) private readonly bundleModel: Model<Bundle>) {}

  async findAll(): Promise<Bundle[]> {
    return this.bundleModel.find().exec();
  }
}
