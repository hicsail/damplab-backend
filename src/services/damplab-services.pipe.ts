import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { DampLabServices } from './damplab-services.services';
import { DampLabService } from './models/damplab-service.model';

@Injectable()
export class DampLabServicePipe implements PipeTransform<string, Promise<DampLabService>> {
  constructor(private readonly dampLabServices: DampLabServices) {}

  async transform(value: string): Promise<DampLabService> {
    try {
      const service = await this.dampLabServices.findOne(value);
      if (!!service) {
        return service;
      }
    } catch (e) {}

    throw new BadRequestException(`DampLabService with ID ${value} does not exist`);
  }
}
