import { Field, ID, ObjectType } from '@nestjs/graphql';
import { CustomerCategory } from '../../job/job.model';

@ObjectType({
  description: 'Keycloak user row for staff customer-category management (pricing groups).'
})
export class KeycloakUserCustomerManagement {
  @Field(() => ID)
  id: string;

  @Field({ nullable: true })
  username?: string;

  @Field({ nullable: true })
  email?: string;

  @Field({ nullable: true })
  firstName?: string;

  @Field({ nullable: true })
  lastName?: string;

  @Field(() => CustomerCategory, {
    nullable: true,
    description: 'Customer pricing category inferred from Keycloak groups (same precedence as job submission).'
  })
  customerCategory?: CustomerCategory;
}
