import { Field, InputType, ID, Float } from '@nestjs/graphql';

@InputType({ description: "Set the job's deposit while issuing its invoice. Refused when the job already has one — void that first." })
export class InvoiceDepositInput {
  @Field(() => Float, { description: 'How much to ask for up front. Must be greater than zero. Part of the invoice total, never added to it.' })
  amount: number;

  @Field({ nullable: true, description: 'What the deposit is called on the invoice. Defaults to "Deposit".' })
  label?: string;

  @Field({ description: 'When the deposit is due.' })
  dueDate: Date;
}

@InputType({ description: 'A charge or discount line to add to the job. A negative amount is a discount.' })
export class InvoiceCustomLineInput {
  @Field({ description: 'What the line is for. Required.' })
  label: string;

  @Field(() => Float, { description: 'Signed: negative for a discount. May not be zero.' })
  amount: number;

  @Field({ nullable: true, description: 'Free text printed under the label.' })
  note?: string;
}

@InputType({ description: "Issue a new version of a job's invoice: everything the job has been charged, less what it has paid. Supersedes the previous version." })
export class CreateInvoiceInput {
  @Field(() => ID, { description: 'Job Mongo _id' })
  jobId: string;

  @Field({ nullable: true, description: 'When payment is due. Defaults to the issue date plus 30 days when omitted.' })
  dueDate?: Date;

  @Field(() => [InvoiceCustomLineInput], {
    nullable: true,
    description: 'New charge or discount lines to add to the job before issuing. Lines already on the job carry over onto every version automatically; removing one is voiding its charge.'
  })
  customLines?: InvoiceCustomLineInput[];

  @Field(() => InvoiceDepositInput, { nullable: true, description: 'Set the job’s deposit before issuing. Refused when the job already has one.' })
  deposit?: InvoiceDepositInput;
}
