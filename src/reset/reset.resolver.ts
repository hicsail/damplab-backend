import { Resolver, Mutation, Args } from '@nestjs/graphql';
import { CategoryInput } from './dtos/category.dto';
import { ServiceInput } from './dtos/service.dto';
import { BundleInput } from './dtos/bundle.dto';
import { ResetService } from './reset.service';

@Resolver()
export class ResetResolver {
  constructor(private readonly resetService: ResetService) {}

  @Mutation(() => Boolean, { description: 'Drop the database' })
  async clearDatabase(): Promise<boolean> {
    await this.resetService.clearDatabase();
    return true;
  }

  @Mutation(() => Boolean, { description: 'Load in services, categories, and bundles' })
  async loadData(
    @Args('services', { type: () => [ServiceInput] }) services: ServiceInput[],
    @Args('categories', { type: () => [CategoryInput] }) categories: CategoryInput[],
    @Args('bundles', { type: () => [BundleInput] }) bundles: BundleInput[]
  ): Promise<boolean> {
    await this.resetService.loadData(services, categories, bundles);
    return true;
  }
}

