import { Field, ID, InputType, Int, ObjectType, PickType } from '@nestjs/graphql';
import { Job, JobAttachment, JobState } from './job.model';
import { AddWorkflowInput, AddWorkflowInputFull, AddWorkflowInputPipe } from '../workflow/dtos/add-workflow.input';
import { BadRequestException, Injectable, PipeTransform, Scope } from '@nestjs/common';
import { JobService } from './job.service';

@InputType()
// CreateJobInput is what the user supplies, and what the CreateJobPipe receives.
export class CreateJobInput extends PickType(Job, ['name', 'institute', 'notes'] as const, InputType) {
  @Field(() => [AddWorkflowInput], { description: 'The workflows that were submitted together' })
  workflows: AddWorkflowInput[];
}

// CreateJobPreProcessed is what the pipe outputs.
export interface CreateJobPreProcessed extends Pick<Job, 'name' | 'institute' | 'notes' | 'state'> {
  workflows: AddWorkflowInputFull[];
}

// CreateJobFull is what the job service receives.
export interface CreateJobFull extends Omit<Job, '_id' | 'workflows' | 'submitted'> {
  workflows: AddWorkflowInputFull[];
}

@InputType()
export class JobAttachmentInput {
  @Field()
  filename: string;

  @Field()
  key: string;

  @Field()
  contentType: string;

  @Field(() => Int)
  size: number;
}

@InputType()
export class JobAttachmentUploadRequest {
  @Field()
  filename: string;

  @Field()
  contentType: string;

  @Field(() => Int)
  size: number;
}

@ObjectType()
export class JobAttachmentUpload {
  @Field()
  filename: string;

  @Field()
  uploadUrl: string;

  @Field()
  key: string;

  @Field()
  contentType: string;

  @Field(() => Int)
  size: number;
}

@Injectable({ scope: Scope.REQUEST })
export class CreateJobPipe implements PipeTransform<CreateJobInput, Promise<CreateJobPreProcessed>> {
  constructor(private readonly workflowPipe: AddWorkflowInputPipe) {}

  async transform(value: CreateJobInput): Promise<CreateJobPreProcessed> {
    const workflows = await Promise.all(value.workflows.map((workflow) => this.workflowPipe.transform(workflow)));
    return { ...value, workflows, state: JobState.SUBMITTED };
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
