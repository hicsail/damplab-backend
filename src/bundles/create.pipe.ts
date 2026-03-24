import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { DampLabServices } from '../services/damplab-services.services';
import { CreateBundle } from './dtos/create.dto';

@Injectable()
export class CreateBundlePipe implements PipeTransform<CreateBundle, Promise<CreateBundle>> {
  constructor(private readonly dampLabServices: DampLabServices) {}

  async transform(value: CreateBundle): Promise<CreateBundle> {
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
