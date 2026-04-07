import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { DampLabServices } from '../services/damplab-services.services';
import { CategoryChange } from './dtos/update.dto';

@Injectable()
export class CategoryUpdatePipe implements PipeTransform<CategoryChange, Promise<CategoryChange>> {
  constructor(private readonly dampLabServices: DampLabServices) {}

  async transform(value: CategoryChange): Promise<CategoryChange> {
    if (value.services) {
      await Promise.all(
        value.services.map(async (serviceId) => {
          const active = await this.dampLabServices.findOneActive(serviceId);
          if (!active) {
            throw new BadRequestException(`DampLabService with ID ${serviceId} does not exist or is deleted`);
          }
        })
      );
    }

    return value;
  }
}
