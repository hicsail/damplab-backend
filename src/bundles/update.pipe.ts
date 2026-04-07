import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { DampLabServices } from '../services/damplab-services.services';
import { BundleChange } from './dtos/update.dto';

@Injectable()
export class BundleUpdatePipe implements PipeTransform<BundleChange, Promise<BundleChange>> {
  constructor(private readonly dampLabServices: DampLabServices) {}

  async transform(value: BundleChange): Promise<BundleChange> {
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
