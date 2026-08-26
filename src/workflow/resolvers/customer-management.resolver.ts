import { BadRequestException, NotFoundException, UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver, registerEnumType } from '@nestjs/graphql';
import { AuthRolesGuard } from '../../auth/auth.guard';
import { Roles } from '../../auth/roles/roles.decorator';
import { Role } from '../../auth/roles/roles.enum';
import { KeycloakService } from '../../keycloak/keycloak.service';
import { CustomerCategory } from '../../job/job.model';
import { KeycloakUserCustomerManagement } from '../dtos/keycloak-customer-user.dto';
import { KeycloakUserCustomerManagementPage } from '../dtos/keycloak-customer-user-page.dto';
import { CATEGORY_PRIMARY_GROUP, PricingGroup } from '../../pricing/pricing-groups';

export enum CustomerManagementUserListCategory {
  ALL = 'ALL',
  STAFF = 'STAFF',
  INTERNAL_CUSTOMERS = 'INTERNAL_CUSTOMERS',
  EXTERNAL_CUSTOMER_DEFAULT = 'EXTERNAL_CUSTOMER_DEFAULT',
  EXTERNAL_CUSTOMER_ACADEMIC = 'EXTERNAL_CUSTOMER_ACADEMIC',
  EXTERNAL_CUSTOMER_MARKET = 'EXTERNAL_CUSTOMER_MARKET',
  EXTERNAL_CUSTOMER_NO_SALARY = 'EXTERNAL_CUSTOMER_NO_SALARY'
}

registerEnumType(CustomerManagementUserListCategory, { name: 'CustomerManagementUserListCategory' });

/** The filter values that name a pricing category outright. */
const LIST_CATEGORY_TO_CUSTOMER_CATEGORY: Record<
  Exclude<CustomerManagementUserListCategory, CustomerManagementUserListCategory.ALL | CustomerManagementUserListCategory.STAFF | CustomerManagementUserListCategory.EXTERNAL_CUSTOMER_DEFAULT>,
  CustomerCategory
> = {
  [CustomerManagementUserListCategory.INTERNAL_CUSTOMERS]: CustomerCategory.INTERNAL_CUSTOMERS,
  [CustomerManagementUserListCategory.EXTERNAL_CUSTOMER_ACADEMIC]: CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC,
  [CustomerManagementUserListCategory.EXTERNAL_CUSTOMER_MARKET]: CustomerCategory.EXTERNAL_CUSTOMER_MARKET,
  [CustomerManagementUserListCategory.EXTERNAL_CUSTOMER_NO_SALARY]: CustomerCategory.EXTERNAL_CUSTOMER_NO_SALARY
};

@Resolver()
export class CustomerManagementResolver {
  constructor(private readonly keycloakService: KeycloakService) {}

  @Query(() => KeycloakUserCustomerManagementPage, {
    description: 'Staff: list Keycloak users by staff/customer category group membership, paginated. Intended for customer management UI browsing (default STAFF).'
  })
  @UseGuards(AuthRolesGuard)
  @Roles(Role.DamplabStaff)
  async listKeycloakUsersForCustomerManagement(
    @Args('category', { type: () => CustomerManagementUserListCategory }) category: CustomerManagementUserListCategory,
    @Args('offset', { type: () => Int, nullable: true, defaultValue: 0 }) offset: number,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: 25 }) limit: number
  ): Promise<KeycloakUserCustomerManagementPage> {
    if (!this.keycloakService.isConfigured()) {
      throw new BadRequestException('Keycloak Admin API is not configured (KEYCLOAK_SERVER_URL, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET).');
    }
    const safeOffset = Math.max(offset ?? 0, 0);
    const safeLimit = Math.min(Math.max(limit ?? 25, 1), 100);

    // Fetch one extra row to determine hasNextPage.
    const first = safeOffset;
    const max = safeLimit + 1;

    let rows;
    if (category === CustomerManagementUserListCategory.ALL) {
      rows = await this.keycloakService.listAllUsersWithCustomerCategory(first, max);
    } else if (category === CustomerManagementUserListCategory.STAFF) {
      rows = await this.keycloakService.listLabStaffWithCustomerCategory(first, max);
    } else if (category === CustomerManagementUserListCategory.EXTERNAL_CUSTOMER_DEFAULT) {
      const raw = await this.keycloakService.listUsersInGroupWithCustomerCategory(PricingGroup.ExternalCustomers, first, max);
      rows = raw.filter((r) => r.isDefaultExternalCustomer === true);
    } else {
      // The remaining filter values name a CustomerCategory directly, so reuse the
      // one category -> group table rather than keeping an inverted copy here.
      rows = await this.keycloakService.listUsersInGroupWithCustomerCategory(CATEGORY_PRIMARY_GROUP[LIST_CATEGORY_TO_CUSTOMER_CATEGORY[category]], first, max);
    }

    const items = rows.slice(0, safeLimit) as unknown as KeycloakUserCustomerManagement[];
    return {
      items,
      hasNextPage: rows.length > safeLimit
    };
  }

  @Query(() => [KeycloakUserCustomerManagement], {
    description: 'Staff: search Keycloak users by name/email/username and return inferred customer pricing category from group membership.'
  })
  @UseGuards(AuthRolesGuard)
  @Roles(Role.DamplabStaff)
  async searchKeycloakUsersForCustomerManagement(
    @Args('search', { type: () => String }) search: string,
    @Args('max', { type: () => Int, nullable: true, defaultValue: 25 }) max: number
  ): Promise<KeycloakUserCustomerManagement[]> {
    if (!this.keycloakService.isConfigured()) {
      throw new BadRequestException('Keycloak Admin API is not configured (KEYCLOAK_SERVER_URL, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET).');
    }
    const trimmed = (search ?? '').trim();
    if (trimmed.length < 2) {
      return [];
    }
    const cap = Math.min(Math.max(max ?? 25, 1), 100);
    return this.keycloakService.searchUsersWithCustomerCategory(trimmed, cap);
  }

  @Mutation(() => KeycloakUserCustomerManagement, {
    description: 'Staff: set a user’s Keycloak pricing customer group to match the given category, or clear all such groups when category is omitted.'
  })
  @UseGuards(AuthRolesGuard)
  @Roles(Role.DamplabStaff)
  async setUserKeycloakCustomerCategory(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('category', { type: () => CustomerCategory, nullable: true }) category: CustomerCategory | null
  ): Promise<KeycloakUserCustomerManagement> {
    if (!this.keycloakService.isConfigured()) {
      throw new BadRequestException('Keycloak Admin API is not configured (KEYCLOAK_SERVER_URL, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET).');
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
