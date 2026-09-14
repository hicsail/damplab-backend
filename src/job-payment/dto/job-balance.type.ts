import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: "What a job has been charged, what it has paid, and the difference — the figures the job's invoice states." })
export class JobBalance {
  @Field(() => ID)
  jobId: string;

  @Field(() => Float, {
    description: "Σ the countersigned SOW's contracted service lines. Zero until the version in force is FINAL. Equipment-use estimates are never included — the job's confirmed bookings bill those."
  })
  serviceCharges: number;

  @Field(() => Float, { description: "The countersigned SOW's pricing adjustments: discounts negative, additional costs positive. Zero until the version in force is FINAL." })
  adjustmentCharges: number;

  @Field(() => Float, { description: 'Sum of the stored cost of every confirmed, non-cancelled booking on the job.' })
  equipmentCharges: number;

  @Field(() => Float, { description: 'Sum of live CUSTOM charges — lines staff add by hand, negative for a discount.' })
  customCharges: number;

  @Field(() => Float, { description: 'serviceCharges + adjustmentCharges + equipmentCharges + customCharges. A deposit is part of this total, never added to it.' })
  chargesToDate: number;

  @Field(() => Float, { description: 'Sum of the job’s payments that have not been voided.' })
  paymentsToDate: number;

  @Field(() => Float, { description: 'chargesToDate minus paymentsToDate. Negative means the customer is in credit.' })
  balanceDue: number;

  @Field(() => Float, { nullable: true, description: "The live DEPOSIT charge's amount, or null when the job has none." })
  depositAmount: number | null;

  // Explicit type: a `Date | null` union cannot be reflected, and the schema
  // build fails at startup without it.
  @Field(() => Date, { nullable: true, description: 'When the deposit is due, or null when the job has none.' })
  depositDueDate: Date | null;

  @Field(() => Float, {
    description: 'What is still owed against the deposit: the deposit less payments, never below zero and never more than the balance due. Zero when there is no deposit.'
  })
  depositOutstanding: number;

  @Field(() => Float, { description: 'Confirmed hours behind equipmentCharges; the slot length where no actual hours were logged.' })
  confirmedHours: number;

  @Field(() => Int, { description: 'Non-cancelled bookings whose usage has not been confirmed yet — work that is not on the invoice.' })
  unconfirmedBookings: number;
}
