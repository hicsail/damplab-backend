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

/**
 * The customer declining what the lab asked them to approve.
 *
 * Carries a required reason for the same reason a withdrawal does: it hands work
 * back to someone else, and it should not land in the comment thread unexplained.
 * Unlike a withdrawal, the reason is written as the *customer's* comment.
 */
@InputType()
export class RejectJobReviewInput {
  @Field()
  operationId: string;

  @Field(() => ID)
  jobId: string;

  @Field({ description: 'Shown to the lab in the automated comment.' })
  reason: string;
}

/** The customer abandoning a job outright, before the SOW is countersigned. */
@InputType()
export class CancelJobInput {
  @Field()
  operationId: string;

  @Field(() => ID)
  jobId: string;

  @Field({ description: 'Shown to the lab in the automated comment.' })
  reason: string;
}

/**
 * The customer asking for the workflow editor.
 *
 * The message is optional: this is a request, not a justification, and requiring
 * prose to ask a question is friction with no payoff. Nothing here grants access
 * — staff still open the canvas with reviewJob(REQUEST_EDITS).
 */
@InputType()
export class RequestJobEditAccessInput {
  @Field()
  operationId: string;

  @Field(() => ID)
  jobId: string;

  @Field({ nullable: true, description: 'Optional note to the lab, posted as a comment.' })
  message?: string;
}
