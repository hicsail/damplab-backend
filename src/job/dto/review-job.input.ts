import { Field, ID, InputType, registerEnumType } from '@nestjs/graphql';

export enum JobReviewDecision {
  ACCEPT = 'ACCEPT',
  REQUEST_CLARIFICATION = 'REQUEST_CLARIFICATION',
  REQUEST_EDITS = 'REQUEST_EDITS',
  REQUEST_APPROVAL = 'REQUEST_APPROVAL'
}
registerEnumType(JobReviewDecision, { name: 'JobReviewDecision' });

@InputType()
export class ReviewJobInput {
  @Field()
  operationId: string;

  @Field(() => ID)
  jobId: string;

  @Field(() => JobReviewDecision)
  decision: JobReviewDecision;

  @Field({ nullable: true })
  message?: string;
}

@InputType()
export class RespondToJobReviewInput {
  @Field()
  operationId: string;

  @Field(() => ID)
  jobId: string;

  @Field({ nullable: true })
  message?: string;
}

/**
 * Taking a job back from the customer, or reopening an accepted spec.
 *
 * Both carry a reason: a withdrawal undoes work someone else did, or reopens
 * something the customer was told was agreed, and neither should land in the
 * comment thread unexplained.
 */
@InputType()
export class WithdrawJobInput {
  @Field()
  operationId: string;

  @Field(() => ID)
  jobId: string;

  @Field({ description: 'Shown to the customer in the automated comment.' })
  reason: string;
}
