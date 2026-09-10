import { Field, InputType, ID, Int } from '@nestjs/graphql';

/**
 * One SOW service line to release onto the statement now.
 *
 * Identified by position, because a job may use the same catalog service more
 * than once and `serviceId` therefore does not identify a line. `serviceId` is
 * carried alongside as a guard: it is what catches the billing source having
 * been re-synced between the release dialog being filled in and submitted.
 */
@InputType({ description: 'A SOW service line to release onto the statement now, identified by its position in billableServices' })
export class ReleaseServiceLineInput {
  @Field(() => Int, { description: 'Zero-based position of the line in SOW.billableServices.' })
  sourceIndex: number;

  @Field(() => ID, { description: 'The serviceId expected at that position. The request is refused if it no longer matches.' })
  serviceId: string;
}

@InputType({ description: "Issue a job's statement of account, releasing zero or more SOW service lines onto it" })
export class CreateInvoiceInput {
  @Field(() => ID, { description: 'Job Mongo _id' })
  jobId: string;

  @Field(() => [ReleaseServiceLineInput], {
    nullable: true,
    description:
      'The SOW service lines to release now, by position in SOW.billableServices. Names only lines newly ' +
      'released with this call — lines already released by a prior statement are not repeated here. A line ' +
      'at an already-released position is a no-op, not an error. An empty (or omitted) list is legitimate: ' +
      'it re-issues a statement of what is already on the ledger, releasing nothing new.'
  })
  releaseServiceLines?: ReleaseServiceLineInput[];

  @Field({ nullable: true, description: 'When payment is due. Defaults to the issue date plus 30 days when omitted.' })
  dueDate?: Date;
}
