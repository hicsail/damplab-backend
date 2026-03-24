import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { DampLabServices } from './damplab-services.services';
import { ServiceChange } from './dtos/update.dto';

@Injectable()
export class ServiceUpdatePipe implements PipeTransform<ServiceChange, Promise<ServiceChange>> {
  constructor(private readonly dampLabServices: DampLabServices) {}

  async transform(value: ServiceChange): Promise<ServiceChange> {
    if (value.allowedConnections) {
      await Promise.all(
        value.allowedConnections.map(async (serviceId) => {
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
