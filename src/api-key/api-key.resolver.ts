import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { ApiKey } from './api-key.model';
import { ApiKeyService } from './api-key.service';
import { CreateApiKeyResult } from './api-key.dto';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';

/** Staff-only provisioning of read-only API keys for external systems. */
@Resolver(() => ApiKey)
@UseGuards(AuthRolesGuard)
@RequirePermission(Permission.ApiKeysManage)
export class ApiKeyResolver {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Query(() => [ApiKey], { description: 'All provisioned API keys (secrets are never returned).' })
  async apiKeys(): Promise<ApiKey[]> {
    return this.apiKeyService.list();
  }

  @Mutation(() => CreateApiKeyResult, { description: 'Create a read-only API key. The raw secret is returned once and cannot be retrieved again.' })
  async createApiKey(@Args('name') name: string, @Args('expiresAt', { type: () => Date, nullable: true }) expiresAt: Date | null, @CurrentUser() user: User): Promise<CreateApiKeyResult> {
    const createdBy = user?.preferred_username || user?.email || 'staff';
    return this.apiKeyService.create(name, createdBy, expiresAt);
  }

  @Mutation(() => ApiKey, { description: 'Revoke an API key immediately.' })
  async revokeApiKey(@Args('id', { type: () => ID }) id: string): Promise<ApiKey> {
    return this.apiKeyService.revoke(id);
  }
}
