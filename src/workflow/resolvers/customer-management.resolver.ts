import { BadRequestException, ForbiddenException, NotFoundException, UseGuards } from '@nestjs/common';
import { Args, ID, Int, Mutation, Query, Resolver, registerEnumType } from '@nestjs/graphql';
import { AuthRolesGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/user.decorator';
import { User } from '../../auth/user.interface';
import { RequirePermission } from '../../auth/permissions/permissions.decorator';
import { Permission } from '../../auth/permissions/permission.enum';
import { AccessTier } from '../../auth/roles/access-tiers';
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
  @RequirePermission(Permission.CustomersManage)
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
  @RequirePermission(Permission.CustomersManage)
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
  @RequirePermission(Permission.CustomersManage)
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

  /**
   * Move a user between access columns of the matrix.
   *
   * Deliberately a **separate** mutation from `setUserKeycloakCustomerCategory` rather
   * than one combined "update user" call. Pricing and access are independent axes, and
   * keeping them as two mutations means neither can accidentally carry the other's
   * value: there is no shape of this request that touches a pricing group.
   *
   * Takes effect at the user's next sign-in. Keycloak does not invalidate issued
   * tokens on a group change, so someone holding a live JWT keeps their old access
   * until it expires. The UI says so; there is nothing to do about it here short of
   * a session logout, which is a bigger hammer than this warrants.
   */
  @Mutation(() => KeycloakUserCustomerManagement, {
    description: 'Administrator: set a user’s access tier by rewriting their Keycloak access-group membership. Pricing groups are never touched. Takes effect at the user’s next sign-in.'
  })
  @UseGuards(AuthRolesGuard)
  @RequirePermission(Permission.CustomersManage)
  async setUserKeycloakAccessTier(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('tier', { type: () => AccessTier }) tier: AccessTier,
    @CurrentUser() user: User
  ): Promise<KeycloakUserCustomerManagement> {
    if (!this.keycloakService.isConfigured()) {
      throw new BadRequestException('Keycloak Admin API is not configured (KEYCLOAK_SERVER_URL, KEYCLOAK_CLIENT_ID, KEYCLOAK_CLIENT_SECRET).');
    }
    // An administrator who demotes themselves loses customers:manage in the same
    // stroke, so nothing they can still reach would let them undo it. Refusing is
    // kinder than a support ticket to edit the realm by hand.
    if (user?.sub && user.sub === userId && tier !== AccessTier.ADMINISTRATOR) {
      throw new ForbiddenException('You cannot lower your own access tier — you would lose the permission needed to restore it. Ask another administrator.');
    }
    try {
      await this.keycloakService.setUserAccessTier(userId, tier);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(msg);
    }
    const row = await this.keycloakService.getUserCustomerManagementRow(userId);
    if (!row) {
      throw new NotFoundException(`Keycloak user ${userId} not found`);
    }
    // Read the realm roles back rather than trusting the PUT: the group write can
    // succeed while granting nothing, if the realm has no group -> role mapping.
    return { ...row, accessRoleMapped: await this.keycloakService.isAccessRoleMapped(userId, tier) } as KeycloakUserCustomerManagement;
  }
}
