import { Field, InputType, ID, Float } from '@nestjs/graphql';

@InputType({ description: "The job's deposit as this version should state it. When it differs from the deposit the job has, that one is voided and replaced." })
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

@InputType({ description: 'An amount due by a date.' })
export class InvoiceDueDateInput {
  @Field(() => Float, { description: 'Greater than zero.' })
  amount: number;

  @Field({ description: 'When it is due.' })
  dueDate: Date;
}

@InputType({ description: "Issue a new version of a job's invoice: everything the job has been charged, less what it has paid. Supersedes the previous version." })
export class CreateInvoiceInput {
  @Field(() => ID, { description: 'Job Mongo _id' })
  jobId: string;

  @Field(() => [InvoiceCustomLineInput], {
    nullable: true,
    description: 'New charge or discount lines to add to the job before issuing. Lines already on the job carry over onto every version; to take one back, add a discount line.'
  })
  customLines?: InvoiceCustomLineInput[];

  @Field(() => InvoiceDepositInput, { nullable: true, description: 'Set or change the job’s deposit while issuing.' })
  deposit?: InvoiceDepositInput;

  @Field({ nullable: true, description: 'Remove the job’s deposit while issuing. Cannot be combined with `deposit`.' })
  removeDeposit?: boolean;

  @Field(() => [InvoiceDueDateInput], {
    nullable: true,
    description:
      "When the balance is due, besides the deposit. Must add up to the balance less the deposit's outstanding amount, to the cent. When omitted, the previous version's dates carry over and anything more that is owed falls due a month out."
  })
  dueSchedule?: InvoiceDueDateInput[];
}
