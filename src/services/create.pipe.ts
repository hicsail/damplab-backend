import { Injectable, PipeTransform } from '@nestjs/common';
import { DampLabServicePipe } from '../services/damplab-services.pipe';
import { CreateService } from './dtos/create.dto';

@Injectable()
export class CreateServicePipe implements PipeTransform<CreateService, Promise<CreateService>> {
  constructor(private readonly damplabServicePipe: DampLabServicePipe) {}

  async transform(value: CreateService): Promise<CreateService> {
    // Ensure the services are valid
    for (const service of value.allowedConnections) {
      await this.damplabServicePipe.transform(service);
    }

    return value;
  }
}
