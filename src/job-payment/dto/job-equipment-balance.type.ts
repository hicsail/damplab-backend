import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: "A job's equipment charges, payments and balance — the figures an equipment invoice states." })
export class JobEquipmentBalance {
  @Field(() => ID)
  jobId: string;

  @Field(() => Float, { description: 'Sum of the stored cost of every confirmed, non-cancelled booking on the job.' })
  chargesToDate: number;

  @Field(() => Float, { description: 'Sum of the job’s payments that have not been voided.' })
  paymentsToDate: number;

  @Field(() => Float, { description: 'chargesToDate minus paymentsToDate. Negative means the customer is in credit.' })
  balanceDue: number;

  @Field(() => Float, { description: 'Confirmed hours behind chargesToDate; the slot length where no actual hours were logged.' })
  confirmedHours: number;

  @Field(() => Int, { description: 'Non-cancelled bookings whose usage has not been confirmed yet — work that is not on the statement.' })
  unconfirmedBookings: number;
}
