import { Injectable, PipeTransform } from '@nestjs/common';
import { ID, InputType, OmitType, Field } from '@nestjs/graphql';
import { Workflow } from '../workflow/models/workflow.model';
import { WorkflowPipe } from '../workflow/workflow.pipe';
import { Job } from './job.model';
import mongoose from 'mongoose';

@InputType()
export class CreateJob extends OmitType(Job, ['_id', 'workflows'] as const, InputType) {
  @Field(() => [ID], { description: 'The workflows that were submitted together' })
  workflows: string[];
}

export type CreateJobFull = Omit<Job, '_id'>;

/** Transform the list of IDs into workflows, ensures the workflows exist */
@Injectable()
export class CreateJobPipe implements PipeTransform<CreateJob, Promise<CreateJobFull>> {
  constructor(private readonly workflowPipe: WorkflowPipe) {}

  async transform(value: CreateJob): Promise<CreateJobFull> {
    const workflows: Workflow[] = await Promise.all(value.workflows.map((id) => this.workflowPipe.transform(id)));
    const workflowIds: mongoose.Types.ObjectId[] = workflows.map((workflow) => new mongoose.Types.ObjectId(workflow._id));
    return { ...value, workflows: workflowIds };
  }
}
