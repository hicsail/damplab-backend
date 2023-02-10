import { InputType, OmitType, Field } from '@nestjs/graphql';
import { Job } from './job.model';
import { AddWorkflowInput } from '../workflow/dtos/add-workflow.input';

@InputType()
export class CreateJob extends OmitType(Job, ['_id', 'workflows', 'submitted'] as const, InputType) {
  @Field(() => [AddWorkflowInput], { description: 'The workflows that were submitted together' })
  workflows: AddWorkflowInput[];
}
