import { Injectable, PipeTransform } from '@nestjs/common';
import { DampLabServicePipe } from '../services/damplab-services.pipe';
import { CategoryChange } from './dtos/update.dto';

@Injectable()
export class CategoryUpdatePipe implements PipeTransform<CategoryChange, Promise<CategoryChange>> {
  constructor(private readonly damplabServicePipe: DampLabServicePipe) {}

  async transform(value: CategoryChange): Promise<CategoryChange> {
    // If services is includes, make sure they are all valid
    if (value.services) {
      await Promise.all(value.services.map((service) => this.damplabServicePipe.transform(service)));
    }

    return value;
  }
}
