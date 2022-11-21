import { Resolver, Query } from '@nestjs/graphql';
import { DampLabServices } from './damplab-services.services';
import { DampLabService } from './models/damplab-service.model';

@Resolver()
export class DampLabServicesResolver {
  constructor(private readonly dampLabServices: DampLabServices) {}

  @Query(() => [DampLabService])
  async services(): Promise<DampLabService[]> {
    return this.dampLabServices.findAll();
  }
}
