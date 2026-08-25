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
