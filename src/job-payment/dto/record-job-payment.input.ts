import { Field, Float, ID, InputType } from '@nestjs/graphql';

@InputType({ description: 'Record a payment received against a job. Payments belong to the job, never to one invoice: every invoice version restates them.' })
export class RecordJobPaymentInput {
  @Field(() => ID, { description: 'Job Mongo _id.' })
  jobId: string;

  @Field(() => Float, { description: 'Amount received. Must be greater than zero.' })
  amount: number;

  @Field({ description: 'The date the lab received the money.' })
  receivedOn: Date;

  @Field({ nullable: true, description: 'Free text: a cheque number, a PO, an ISR reference.' })
  reference?: string;

  @Field({ nullable: true, description: 'Free-text note.' })
  note?: string;
}
