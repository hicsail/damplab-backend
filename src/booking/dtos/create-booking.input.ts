import { InputType, Field, ID, Int } from '@nestjs/graphql';

@InputType()
export class CreateBookingInput {
  @Field(() => ID, { description: 'Inventory item to book.' })
  inventoryItemId: string;

  // TIMED (machine) — required for hourly items
  @Field({ nullable: true, description: 'Reservation start (TIMED items).' })
  startTime?: Date;

  @Field({ nullable: true, description: 'Reservation end (TIMED items).' })
  endTime?: Date;

  // QUANTITY (consumable)
  @Field(() => Int, { nullable: true, description: 'Quantity to book (QUANTITY items).' })
  quantity?: number;

  @Field({ nullable: true, description: 'Date the consumable is used (QUANTITY items). Defaults to now.' })
  usedOn?: Date;

  @Field({ nullable: true })
  notes?: string;

  // Owner overrides — staff booking on behalf of a user. When omitted, the
  // booking owner defaults to the current (authenticated) user.
  @Field({ nullable: true, description: 'Owner Keycloak sub (staff booking on behalf). Defaults to current user.' })
  ownerSub?: string;

  @Field({ nullable: true, description: 'Owner email. Defaults to current user.' })
  ownerEmail?: string;

  @Field({ nullable: true })
  ownerName?: string;

  @Field({ nullable: true })
  ownerInstitution?: string;

  @Field({ nullable: true, description: 'Customer category for rate resolution (e.g. INTERNAL_CUSTOMERS).' })
  customerCategory?: string;
}
