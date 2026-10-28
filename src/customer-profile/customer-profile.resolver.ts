import { UseGuards } from '@nestjs/common';
import { Args, ID, Mutation, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { KeycloakUserCustomerManagement } from '../workflow/dtos/keycloak-customer-user.dto';
import { CustomerProfile, UpdateCustomerProfileInput } from './customer-profile.model';
import { CustomerProfileService, toCustomerProfile } from './customer-profile.service';

@Resolver(() => KeycloakUserCustomerManagement)
export class CustomerProfileResolver {
  constructor(private readonly profiles: CustomerProfileService) {}

  @Mutation(() => CustomerProfile, {
    description: "Administrator: set a user's stored Customer Management fields. Fields present are set (null or empty clears), absent ones are untouched. Never touches Keycloak."
  })
  @UseGuards(AuthRolesGuard)
  @RequirePermission(Permission.CustomersManage)
  async updateCustomerProfile(
    @Args('userId', { type: () => ID }) userId: string,
    @Args('input', { type: () => UpdateCustomerProfileInput }) input: UpdateCustomerProfileInput,
    @CurrentUser() user: User
  ): Promise<CustomerProfile> {
    return this.profiles.upsert(userId, input, user?.sub);
  }

  /** Reachable only through rows the customers:manage queries and mutations return; no gate of its own. */
  @ResolveField('profile', () => CustomerProfile)
  async profile(@Parent() row: KeycloakUserCustomerManagement): Promise<CustomerProfile> {
    if (row.profile) return row.profile;
    return toCustomerProfile(row.id, await this.profiles.findBySub(row.id));
  }
}
