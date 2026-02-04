import { InputType, Field, ObjectType, Int, registerEnumType } from '@nestjs/graphql';
import { Job, JobState } from '../job.model';

export enum JobSortField {
  SUBMITTED = 'SUBMITTED',
  NAME = 'NAME'
}
registerEnumType(JobSortField, { name: 'JobSortField' });

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC'
}
registerEnumType(SortOrder, { name: 'SortOrder' });

@InputType()
export class OwnJobsInput {
  @Field(() => Int, { description: 'Page (1-based)', nullable: true })
  page?: number;

  @Field(() => Int, { description: 'Items per page', nullable: true })
  limit?: number;

  @Field({ description: 'Case-insensitive search on name, id, username, email, institute', nullable: true })
  search?: string;

  @Field(() => JobState, { description: 'Filter by job state', nullable: true })
  state?: JobState;

  @Field({ description: 'Filter by presence of SOW', nullable: true })
  hasSow?: boolean;

  @Field(() => JobSortField, { description: 'Sort field (default SUBMITTED)', nullable: true })
  sortBy?: JobSortField;

  @Field(() => SortOrder, { description: 'Sort order (default DESC = latest first)', nullable: true })
  sortOrder?: SortOrder;
}

@InputType()
export class AllJobsInput {
  @Field(() => Int, { description: 'Page (1-based)', nullable: true })
  page?: number;

  @Field(() => Int, { description: 'Items per page', nullable: true })
  limit?: number;

  @Field({ description: 'Case-insensitive search on name, id, username, email, institute', nullable: true })
  search?: string;

  @Field(() => JobState, { description: 'Filter by job state', nullable: true })
  state?: JobState;

  @Field({ description: 'Filter by presence of SOW', nullable: true })
  hasSow?: boolean;

  @Field(() => JobSortField, { description: 'Sort field (default SUBMITTED)', nullable: true })
  sortBy?: JobSortField;

  @Field(() => SortOrder, { description: 'Sort order (default DESC = latest first)', nullable: true })
  sortOrder?: SortOrder;
}

@ObjectType()
export class OwnJobsResult {
  @Field(() => [Job], { description: 'Jobs for the current user' })
  items: Job[];

  @Field(() => Int, { description: 'Total count (for pagination UI)' })
  totalCount: number;
}

@ObjectType()
export class JobsResult {
  @Field(() => [Job], { description: 'All jobs (staff-only)' })
  items: Job[];

  @Field(() => Int, { description: 'Total count (for pagination UI)' })
  totalCount: number;
}
