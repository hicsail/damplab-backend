import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { DampLabServices } from '../services/damplab-services.services';
import { CreateCategory } from './dtos/create.dto';

@Injectable()
export class CreateCategoryPipe implements PipeTransform<CreateCategory, Promise<CreateCategory>> {
  constructor(private readonly dampLabServices: DampLabServices) {}

  async transform(value: CreateCategory): Promise<CreateCategory> {
    for (const serviceId of value.services) {
      const active = await this.dampLabServices.findOneActive(serviceId);
      if (!active) {
        throw new BadRequestException(`DampLabService with ID ${serviceId} does not exist or is deleted`);
      }
    }

    return value;
  }
}
