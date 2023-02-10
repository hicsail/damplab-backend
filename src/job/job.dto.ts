import { InputType, OmitType, Field } from '@nestjs/graphql';
import { Job } from './job.model';
import { AddWorkflowInput, AddWorkflowInputFull, AddWorkflowInputPipe } from '../workflow/dtos/add-workflow.input';
import { Injectable, PipeTransform } from '@nestjs/common';

@InputType()
export class CreateJob extends OmitType(Job, ['_id', 'workflows', 'submitted'] as const, InputType) {
  @Field(() => [AddWorkflowInput], { description: 'The workflows that were submitted together' })
  workflows: AddWorkflowInput[];
}

export interface CreateJobFull extends Omit<Job, '_id' | 'workflows' | 'submitted'> {
  workflows: AddWorkflowInputFull[];
}

@Injectable()
export class CreateJobPipe implements PipeTransform<CreateJob, Promise<CreateJobFull>> {
  constructor(private readonly workflowPipe: AddWorkflowInputPipe) {}

  async transform(value: CreateJob): Promise<CreateJobFull> {
    const workflows = await Promise.all(value.workflows.map((workflow) => this.workflowPipe.transform(workflow)));
    return { ...value, workflows };
  }
}
