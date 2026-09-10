import { Field, Float, ID, InputType } from '@nestjs/graphql';
import { JobChargeKind } from '../job-charge.model';

@InputType({ description: 'Add a charge to a job. SERVICE_LINE charges are released by generating an invoice, not added through this input.' })
export class AddJobChargeInput {
  @Field(() => ID, { description: 'Job Mongo _id.' })
  jobId: string;

  @Field(() => JobChargeKind, { description: 'What kind of charge this is.' })
  kind: JobChargeKind;

  @Field({ description: 'What the charge is for, shown on the statement.' })
  label: string;

  @Field({ nullable: true, description: 'Free text shown under the label on the statement.' })
  note?: string;

  @Field(() => Float, { description: 'Amount of the charge. CUSTOM may be negative; DEPOSIT must be greater than zero.' })
  amount: number;
}
