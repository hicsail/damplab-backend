import { Field, InputType, ID, Int } from '@nestjs/graphql';

/**
 * One service line picked for an invoice.
 *
 * Identified by position, because a job may use the same catalog service more
 * than once and `serviceId` therefore does not identify a line. `serviceId` is
 * carried alongside as a guard: it is what catches the billing source having
 * been re-synced between the invoice dialog being filled in and submitted.
 */
@InputType({ description: 'A service line on the SOW, identified by its position in billableServices' })
export class InvoiceServiceSelectionInput {
  @Field(() => Int, { description: 'Zero-based position of the line in SOW.billableServices.' })
  index: number;

  @Field(() => ID, { description: 'The serviceId expected at that position. The request is refused if it no longer matches.' })
  serviceId: string;
}

@InputType({ description: 'Create an invoice for a job covering some or all of its SOW service lines' })
export class CreateInvoiceInput {
  @Field(() => ID, { description: 'Job Mongo _id' })
  jobId: string;

  @Field(() => [InvoiceServiceSelectionInput], {
    nullable: true,
    description: 'The service lines to bill, by position in SOW.billableServices. Provide this or serviceIds, not both.'
  })
  services?: InvoiceServiceSelectionInput[];

  @Field(() => [ID], {
    nullable: true,
    deprecationReason: 'Service ids cannot identify a line when a job uses the same service twice, which billed the duplicate twice and dropped the other. Use `services`.',
    description: 'Legacy selection by SOW service id. Resolved as a multiset, one line per entry.'
  })
  serviceIds?: string[];
}
