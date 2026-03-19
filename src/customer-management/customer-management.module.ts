import { Module } from '@nestjs/common';
import { KeycloakModule } from '../keycloak/keycloak.module';
import { CustomerManagementResolver } from '../workflow/resolvers/customer-management.resolver';

/**
 * Staff Keycloak customer-category API (GraphQL). Kept separate from WorkflowModule
 * so the schema always picks up these root queries/mutations reliably.
 */
@Module({
  imports: [KeycloakModule],
  providers: [CustomerManagementResolver]
})
export class CustomerManagementModule {}
