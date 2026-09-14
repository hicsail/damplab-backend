import { Field, Float, ID, InputType } from '@nestjs/graphql';
import { JobChargeKind } from '../job-charge.model';

@InputType({ description: 'Add a custom line or the deposit to a job. SERVICE_LINE is legacy and refused.' })
export class AddJobChargeInput {
  @Field(() => ID, { description: 'Job Mongo _id.' })
  jobId: string;

  @Field(() => JobChargeKind, { description: 'What kind of charge this is.' })
  kind: JobChargeKind;

  @Field({ description: 'What the charge is for, shown on the invoice.' })
  label: string;

  @Field({ nullable: true, description: 'Free text shown under the label on the invoice.' })
  note?: string;

  @Field(() => Float, { description: 'Amount of the charge. CUSTOM may be negative (a discount); DEPOSIT must be greater than zero.' })
  amount: number;

  @Field({ nullable: true, description: 'When a DEPOSIT is due. Required for a DEPOSIT, ignored otherwise.' })
  dueDate?: Date;
}
