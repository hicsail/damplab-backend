import { Injectable, PipeTransform } from '@nestjs/common';
import { DampLabServicePipe } from '../services/damplab-services.pipe';
import { CreateCategory } from './dtos/create.dto';

@Injectable()
export class CreateCategoryPipe implements PipeTransform<CreateCategory, Promise<CreateCategory>> {
  constructor(private readonly damplabServicePipe: DampLabServicePipe) {}

  async transform(value: CreateCategory): Promise<CreateCategory> {
    // Ensure the services are valid
    for (const service of value.services) {
      await this.damplabServicePipe.transform(service);
    }

    return value;
  }
}
