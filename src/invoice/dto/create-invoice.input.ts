import { Field, InputType, ID } from '@nestjs/graphql';

@InputType({ description: 'Create an invoice for a job using a subset of SOW service IDs' })
export class CreateInvoiceInput {
  @Field(() => ID, { description: 'Job Mongo _id' })
  jobId: string;

  @Field(() => [ID], {
    description: 'List of SOW service IDs (serviceId) to include on this invoice. Must be non-empty.'
  })
  serviceIds: string[];
}

