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

/** Which archive bucket a jobs listing should return. Defaults to ACTIVE. */
export enum JobArchiveFilter {
  /** Only jobs that are not archived (the default view). */
  ACTIVE = 'ACTIVE',
  /** Only archived jobs. */
  ARCHIVED = 'ARCHIVED',
  /** Both, ignoring archive status. */
  ALL = 'ALL'
}
registerEnumType(JobArchiveFilter, { name: 'JobArchiveFilter' });

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

  @Field(() => JobArchiveFilter, { description: 'Archive bucket to return (default ACTIVE — archived jobs hidden)', nullable: true })
  archiveFilter?: JobArchiveFilter;
}

/**
 * Whose jobs a listing should return.
 *
 * The scope is **enforced server-side**, not merely offered: a caller without
 * `jobs:view-all` is forced to CREATED_BY_ME whatever they ask for. That is what
 * makes it safe for one page to serve both a client and a technician.
 */
export enum JobScope {
  /** Every job. Requires jobs:view-all; silently narrowed otherwise. */
  ALL = 'ALL',
  /** Jobs the caller submitted. The only scope a client can get. */
  CREATED_BY_ME = 'CREATED_BY_ME',
  /**
   * Jobs with at least one operation assigned to the caller.
   *
   * **Read-only.** It is a join through workflows to workflow nodes on
   * `assigneeId`; it writes nothing and `Job` gains no field for it. Requires
   * jobs:view-all — a client has no operations assigned to them.
   */
  WORKED_BY_ME = 'WORKED_BY_ME'
}
registerEnumType(JobScope, { name: 'JobScope' });

/**
 * The merged jobs page. One input for what used to be `ownJobs` and `allJobs`,
 * with the scope and the two staff filters the server may or may not honour.
 */
@InputType()
export class JobsForViewerInput extends AllJobsInput {
  @Field(() => JobScope, { description: 'Whose jobs. Forced to CREATED_BY_ME without jobs:view-all, whatever is sent.', nullable: true })
  scope?: JobScope;

  @Field({ description: 'Filter to one client, by their Keycloak sub. Ignored without jobs:view-all.', nullable: true })
  createdBySub?: string;

  @Field({ description: 'Filter to jobs with an operation assigned to this person. Ignored without jobs:view-all.', nullable: true })
  assigneeId?: string;
}

@ObjectType()
export class OwnJobsResult {
  @Field(() => [Job], { description: 'Jobs for the current user' })
  items: Job[];

  @Field(() => Int, { description: 'Total count (for pagination UI)' })
  totalCount: number;
}

/** One distinct submitter, for the merged jobs page's client filter. */
@ObjectType()
export class JobClient {
  @Field({ description: "The client's Keycloak sub — what `createdBySub` takes." })
  sub: string;

  @Field({ description: 'Best available label: display name, else username, else email.' })
  displayName: string;
}

@ObjectType()
export class JobsResult {
  @Field(() => [Job], { description: 'All jobs (staff-only)' })
  items: Job[];

  @Field(() => Int, { description: 'Total count (for pagination UI)' })
  totalCount: number;
}
