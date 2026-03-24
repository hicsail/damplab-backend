import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { DampLabServices } from './damplab-services.services';
import { CreateService } from './dtos/create.dto';

@Injectable()
export class CreateServicePipe implements PipeTransform<CreateService, Promise<CreateService>> {
  constructor(private readonly dampLabServices: DampLabServices) {}

  async transform(value: CreateService): Promise<CreateService> {
    for (const serviceId of value.allowedConnections) {
      const active = await this.dampLabServices.findOneActive(serviceId);
      if (!active) {
        throw new BadRequestException(`DampLabService with ID ${serviceId} does not exist or is deleted`);
      }
    }

    return value;
  }
}
