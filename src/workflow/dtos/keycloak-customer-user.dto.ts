import { Field, ID, ObjectType } from '@nestjs/graphql';
import { CustomerCategory } from '../../job/job.model';
import { AccessTier } from '../../auth/roles/access-tiers';

@ObjectType({
  description:
    'Keycloak user row for Customer Management. Carries both axes: the pricing category (which groups set price) and the access tier (which groups set permissions). They are independent — changing one never changes the other.'
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

  @Field(() => Boolean, {
    nullable: true,
    description:
      "True when the user's only pricing-group membership is the legacy `external-customer` (the default group new sign-ups land in). Lets staff distinguish a user who has not been explicitly categorized yet from one who is intentionally in External — market."
  })
  isDefaultExternalCustomer?: boolean;

  @Field(() => AccessTier, {
    nullable: true,
    description: 'The access column this user resolves to, from their access-group membership. CLIENT means they carry no access group — the baseline every authenticated user gets.'
  })
  accessTier?: AccessTier;

  @Field(() => Boolean, {
    nullable: true,
    description:
      'False when the access group was written but the realm role it is meant to map to is absent from the user. The guard reads realm roles, not groups, so an unmapped group grants nothing — this reports that rather than letting the change look successful. Only populated on the row returned by setUserKeycloakAccessTier; null elsewhere, because checking it per row would double the Admin API calls a list page makes.'
  })
  accessRoleMapped?: boolean;
}
