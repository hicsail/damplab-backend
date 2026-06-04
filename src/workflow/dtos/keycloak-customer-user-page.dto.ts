import { Field, ObjectType } from '@nestjs/graphql';
import { KeycloakUserCustomerManagement } from './keycloak-customer-user.dto';

@ObjectType({
  description: 'Paginated Keycloak user rows for staff customer-category management.'
})
export class KeycloakUserCustomerManagementPage {
  @Field(() => [KeycloakUserCustomerManagement])
  items: KeycloakUserCustomerManagement[];

  @Field(() => Boolean, {
    description: 'True when another page of results may exist.'
  })
  hasNextPage: boolean;
}

