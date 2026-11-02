import { Injectable, NotFoundException, UseGuards } from '@nestjs/common';
import { Args, ID, Query, Resolver } from '@nestjs/graphql';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { KeycloakService } from '../keycloak/keycloak.service';
import { assertShowsBiosecurity, callerShowsBiosecurity } from './biosecurity-gate';
import { JobScreeningService } from './job-screening.service';
import { JobService } from './job.service';
import { JobAcceptanceScreening, ScreeningRun } from './screening-run.model';
import { ScreeningRunService } from './screening-run.service';

/**
 * A job's screening history. Not a field on `Job`: `ownJobById` (customers) would reach it
 * unless every resolver redacted it. `jobs:view-all` keeps customers out; the inline
 * `showBiosecurity` check keeps out staff whose account hides the block (behaviour 9).
 *
 * `jobAcceptanceScreening` is the one exception: it takes no `showBiosecurity` check, because it
 * returns a state and a message and never a result. Staff who cannot see the card still learn why
 * Accept is off.
 */
@Injectable()
@Resolver(() => ScreeningRun)
@UseGuards(AuthRolesGuard)
export class ScreeningRunResolver {
  constructor(
    private readonly runs: ScreeningRunService,
    private readonly keycloakService: KeycloakService,
    private readonly jobScreeningService: JobScreeningService,
    private readonly jobService: JobService
  ) {}

  @Query(() => [ScreeningRun], { description: "A job's biosecurity screening runs, newest first. Without the raw Aclid report and per-sequence details — read one run for those." })
  @RequirePermission(Permission.JobsViewAll)
  async jobScreeningRuns(@Args('jobId', { type: () => ID }) jobId: string, @CurrentUser() user: User): Promise<ScreeningRun[]> {
    await assertShowsBiosecurity(this.keycloakService, user);
    return this.runs.findForJob(jobId);
  }

  @Query(() => ScreeningRun, { nullable: true, description: 'One screening run, including the raw Aclid report and per-sequence details.' })
  @RequirePermission(Permission.JobsViewAll)
  async screeningRun(@Args('id', { type: () => ID }) id: string, @CurrentUser() user: User): Promise<ScreeningRun | null> {
    await assertShowsBiosecurity(this.keycloakService, user);
    return this.runs.findById(id);
  }

  @Query(() => JobAcceptanceScreening, { description: 'Whether screening lets this job be accepted, and why not. State and message only, never results.' })
  @RequirePermission(Permission.JobsViewAll)
  async jobAcceptanceScreening(@Args('jobId', { type: () => ID }) jobId: string, @CurrentUser() user: User): Promise<JobAcceptanceScreening> {
    const job = await this.jobService.findById(jobId);
    if (!job) throw new NotFoundException(`Job with ID ${jobId} not found`);
    return this.jobScreeningService.acceptanceScreening(job, { callerCanScreen: await callerShowsBiosecurity(this.keycloakService, user) });
  }
}
