import { BadRequestException, NotFoundException, UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { AuthRolesGuard } from '../../auth/auth.guard';
import { Roles } from '../../auth/roles/roles.decorator';
import { Role } from '../../auth/roles/roles.enum';
import { KeycloakService } from '../../keycloak/keycloak.service';
import { CustomerCategory } from '../../job/job.model';
import { KeycloakUserCustomerManagement } from '../dtos/keycloak-customer-user.dto';

@Resolver()
export class CustomerManagementResolver {
  constructor(private readonly keycloakService: KeycloakService) {}

  @Query(() => [KeycloakUserCustomerManagement], {
    description:
      'Staff: search Keycloak users by name/email/username and return inferred customer pricing category from group membership.'
  })
  @UseGuards(AuthRolesGuard)
  @Roles(Role.DamplabStaff)
  async searchKeycloakUsersForCustomerManagement(
    @Args('search', { type: () => String }) search: string,
    @Args('max', { type: () => Int, nullable: true, defaultValue: 25 }) max: number
  ): Promise<KeycloakUserCustomerManagement[]> {
    if (!this.keycloakService.isConfigured()) {
      throw new BadRequestException(
        'Keycloak Admin API is not configured (KEYCLOAK_SERVER_URL, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET).'
      );
    }
    const trimmed = (search ?? '').trim();
    if (trimmed.length < 2) {
      return [];
    }
    const cap = Math.min(Math.max(max ?? 25, 1), 100);
    return this.keycloakService.searchUsersWithCustomerCategory(trimmed, cap);
  }

  @Mutation(() => KeycloakUserCustomerManagement, {
    description:
      'Staff: set a user’s Keycloak pricing customer group to match the given category, or clear all such groups when category is omitted.'
  })
  @UseGuards(AuthRolesGuard)
  @Roles(Role.DamplabStaff)
  async setUserKeycloakCustomerCategory(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('category', { type: () => CustomerCategory, nullable: true }) category: CustomerCategory | null
  ): Promise<KeycloakUserCustomerManagement> {
    if (!this.keycloakService.isConfigured()) {
      throw new BadRequestException(
        'Keycloak Admin API is not configured (KEYCLOAK_SERVER_URL, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET).'
      );
    }
    try {
      await this.keycloakService.setUserCustomerCategory(userId, category ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(msg);
    }
    const row = await this.keycloakService.getUserCustomerManagementRow(userId);
    if (!row) {
      throw new NotFoundException(`Keycloak user ${userId} not found`);
    }
    return row;
  }
}
