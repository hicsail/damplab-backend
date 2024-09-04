import { Injectable, NotFoundException, PipeTransform } from '@nestjs/common';
import { Bundle } from './bundles.model';
import { BundlesService } from './bundles.service';

@Injectable()
export class BundlesPipe implements PipeTransform<string, Promise<Bundle>> {
  constructor(private readonly bundleService: BundlesService) {}

  async transform(value: string): Promise<Bundle> {
    const bundle = await this.bundleService.find(value);

    if(!bundle) {
      throw new NotFoundException(`Bundle with id ${value} not found`);
    }
    return bundle;
  }
}
