import { Field, Float, ID, InputType, Int, ObjectType } from '@nestjs/graphql';

@InputType()
export class GenerateUsageBillingInput {
  @Field(() => ID, { description: 'Owner (billed user) Keycloak sub.' })
  ownerSub: string;

  @Field(() => [ID], { description: 'Confirmed, unbilled booking ids to roll into the SOW + invoice.' })
  bookingIds: string[];

  @Field({ nullable: true, description: 'Optional SOW title.' })
  title?: string;

  @Field({ nullable: true, description: 'Optional terms text (defaults to standard terms).' })
  terms?: string;

  @Field({ nullable: true })
  additionalInformation?: string;

  @Field({ nullable: true, description: 'Override the billed institution (else taken from the bookings).' })
  billToInstitution?: string;
}

@ObjectType({ description: 'A user with confirmed, unbilled inventory usage awaiting a SOW/invoice.' })
export class BillableOwner {
  @Field(() => ID)
  ownerSub: string;

  @Field()
  ownerEmail: string;

  @Field({ nullable: true })
  ownerName?: string;

  @Field(() => Int)
  bookingCount: number;

  @Field(() => Float)
  totalCost: number;
}
