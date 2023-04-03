import { InputType, OmitType, Field } from '@nestjs/graphql';
import { Job, JobState } from './job.model';
import { AddWorkflowInput, AddWorkflowInputFull, AddWorkflowInputPipe } from '../workflow/dtos/add-workflow.input';
import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { JobService } from './job.service';

@InputType()
export class CreateJob extends OmitType(Job, ['_id', 'workflows', 'submitted', 'state'] as const, InputType) {
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
    return { ...value, workflows, state: JobState.CREATING };
  }
}

@Injectable()
export class JobPipe implements PipeTransform<string, Promise<Job>> {
  constructor(private readonly jobService: JobService) {}

  async transform(value: string): Promise<Job> {
    try {
      const job = await this.jobService.findById(value);
      if (job) {
        return job;
      }
    } catch {}

    throw new BadRequestException(`Job with ID ${value} not found`);
  }
}
