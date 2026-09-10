import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: "A job's charges, payments and balance — the whole ledger a statement of account states." })
export class JobBalance {
  @Field(() => ID)
  jobId: string;

  @Field(() => Float, { description: 'Sum of live SERVICE_LINE charges — SOW positions released onto the job.' })
  serviceCharges: number;

  @Field(() => Float, {
    description: "The SOW's pricing adjustments (discounts, additional costs), prorated by the released share of the FINAL version's services subtotal. Zero unless the active version is FINAL."
  })
  adjustmentCharges: number;

  @Field(() => Float, { description: 'Sum of the stored cost of every confirmed, non-cancelled booking on the job.' })
  equipmentCharges: number;

  @Field(() => Float, { description: 'Sum of live CUSTOM charges — free-text lines staff add by hand, which may be negative.' })
  customCharges: number;

  @Field(() => Float, { description: 'Sum of live DEPOSIT charges. Zero once a service line has been released — see depositsDropped.' })
  depositCharges: number;

  @Field(() => Boolean, { description: 'True when deposits were charged but a service line has since been released, dropping them from the balance.' })
  depositsDropped: boolean;

  @Field(() => Float, { description: 'serviceCharges + adjustmentCharges + equipmentCharges + customCharges + depositCharges.' })
  chargesToDate: number;

  @Field(() => Float, { description: 'Sum of the job’s payments that have not been voided.' })
  paymentsToDate: number;

  @Field(() => Float, { description: 'chargesToDate minus paymentsToDate. Negative means the customer is in credit.' })
  balanceDue: number;

  @Field(() => Float, { description: 'Confirmed hours behind equipmentCharges; the slot length where no actual hours were logged.' })
  confirmedHours: number;

  @Field(() => Int, { description: 'Non-cancelled bookings whose usage has not been confirmed yet — work that is not on the statement.' })
  unconfirmedBookings: number;
}
