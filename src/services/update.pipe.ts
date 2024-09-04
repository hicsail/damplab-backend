import { Injectable, PipeTransform } from '@nestjs/common';
import { DampLabServicePipe } from '../services/damplab-services.pipe';
import { ServiceChange } from './dtos/update.dto';

@Injectable()
export class ServiceUpdatePipe implements PipeTransform<ServiceChange, Promise<ServiceChange>> {
  constructor(private readonly damplabServicePipe: DampLabServicePipe) {}

  async transform(value: ServiceChange): Promise<ServiceChange> {
    // If services is includes, make sure they are all valid
    if (value.allowedConnections) {
      await Promise.all(value.allowedConnections.map((service) => this.damplabServicePipe.transform(service)));
    }

    return value;
  }
}
