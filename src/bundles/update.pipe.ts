import { Injectable, PipeTransform } from '@nestjs/common';
import { DampLabServicePipe } from '../services/damplab-services.pipe';
import { BundleChange } from './dtos/update.dto';

@Injectable()
export class BundleUpdatePipe implements PipeTransform<BundleChange, Promise<BundleChange>> {
  constructor(private readonly damplabServicePipe: DampLabServicePipe) {}

  async transform(value: BundleChange): Promise<BundleChange> {
    // If services is includes, make sure they are all valid
    if (value.services) {
      await Promise.all(value.services.map((service) => this.damplabServicePipe.transform(service)));
    }

    return value;
  }
}
