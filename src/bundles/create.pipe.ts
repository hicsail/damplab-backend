import { Injectable, PipeTransform } from '@nestjs/common';
import { DampLabServicePipe } from '../services/damplab-services.pipe';
import { CreateBundle } from './dtos/create.dto';

@Injectable()
export class CreateBundlePipe implements PipeTransform<CreateBundle, Promise<CreateBundle>> {
  constructor(private readonly damplabServicePipe: DampLabServicePipe) {}

  async transform(value: CreateBundle): Promise<CreateBundle> {
    if (value.services) {
      await Promise.all(value.services.map((service) => this.damplabServicePipe.transform(service)));
    }
    return value;
  }
}
