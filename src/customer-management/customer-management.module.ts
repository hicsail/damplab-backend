import { Module } from '@nestjs/common';
import { KeycloakModule } from '../keycloak/keycloak.module';
import { CustomerProfileModule } from '../customer-profile/customer-profile.module';
import { CustomerManagementResolver } from '../workflow/resolvers/customer-management.resolver';

/**
 * Staff Keycloak customer-category API (GraphQL). Kept separate from WorkflowModule
 * so the schema always picks up these root queries/mutations reliably.
 */
@Module({
  imports: [KeycloakModule, CustomerProfileModule],
  providers: [CustomerManagementResolver]
})
export class CustomerManagementModule {}
