import { Resolver, Query } from '@nestjs/graphql';
import { Services } from './services.service';
import { Service } from './models/service.model';

@Resolver()
export class ServicesResolver {
  constructor(private readonly servicesS: Services) {}

  @Query(() => [Service])
  async services(): Promise<Service[]> {
    return this.servicesS.findAll();
  }
}
