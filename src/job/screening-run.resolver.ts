import { Injectable, NotFoundException, UseGuards } from '@nestjs/common';
import { Args, ID, Query, Resolver } from '@nestjs/graphql';
import { AuthRolesGuard } from '../auth/auth.guard';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { JobScreeningService } from './job-screening.service';
import { JobService } from './job.service';
import { JobAcceptanceScreening, ScreeningRun } from './screening-run.model';
import { ScreeningRunService } from './screening-run.service';

/**
 * A job's screening history. Not a field on `Job`: `ownJobById` (customers) would reach it
 * unless every resolver redacted it. `jobs:view-all` (Administrator, Technician) is the whole
 * gate; there is no per-account switch. `jobAcceptanceScreening` returns a state and a message,
 * never a result.
 */
@Injectable()
@Resolver(() => ScreeningRun)
@UseGuards(AuthRolesGuard)
export class ScreeningRunResolver {
  constructor(private readonly runs: ScreeningRunService, private readonly jobScreeningService: JobScreeningService, private readonly jobService: JobService) {}

  @Query(() => [ScreeningRun], { description: "A job's biosecurity screening runs, newest first. Without the raw Aclid report and per-sequence details — read one run for those." })
  @RequirePermission(Permission.JobsViewAll)
  async jobScreeningRuns(@Args('jobId', { type: () => ID }) jobId: string): Promise<ScreeningRun[]> {
    return this.runs.findForJob(jobId);
  }

  @Query(() => ScreeningRun, { nullable: true, description: 'One screening run, including the raw Aclid report and per-sequence details.' })
  @RequirePermission(Permission.JobsViewAll)
  async screeningRun(@Args('id', { type: () => ID }) id: string): Promise<ScreeningRun | null> {
    return this.runs.findById(id);
  }

  @Query(() => JobAcceptanceScreening, { description: 'Whether screening lets this job be accepted, and why not. State and message only, never results.' })
  @RequirePermission(Permission.JobsViewAll)
  async jobAcceptanceScreening(@Args('jobId', { type: () => ID }) jobId: string): Promise<JobAcceptanceScreening> {
    const job = await this.jobService.findById(jobId);
    if (!job) throw new NotFoundException(`Job with ID ${jobId} not found`);
    return this.jobScreeningService.acceptanceScreening(job);
  }
}
