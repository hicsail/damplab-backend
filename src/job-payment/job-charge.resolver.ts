import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { NotFoundException, UseGuards } from '@nestjs/common';
import { JobCharge } from './job-charge.model';
import { JobChargeService } from './job-charge.service';
import { AddJobChargeInput } from './dto/add-job-charge.input';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { JobService } from '../job/job.service';
import { assertMayReadJobFinancials } from '../job/job-read-access';

@Resolver(() => JobCharge)
@UseGuards(AuthRolesGuard)
export class JobChargeResolver {
  constructor(private readonly charges: JobChargeService, private readonly jobService: JobService) {}

  /**
   * Deliberately carries NO `@RequirePermission`, exactly like `jobPayments`:
   * this loads on the customer's own job page and they hold no billing
   * permission. `assertMayReadJobFinancials` is the server-side twin of the
   * card that renders it.
   */
  @Query(() => [JobCharge], { description: "A job's charge ledger, voided lines included." })
  async jobCharges(@Args('jobId', { type: () => ID }) jobId: string, @CurrentUser() user: User): Promise<JobCharge[]> {
    const job = await this.jobService.findById(jobId);
    assertMayReadJobFinancials(job as any, user);
    return this.charges.findByJobId(String((job as any)._id));
  }

  @Mutation(() => JobCharge, { description: 'Add a charge to a job.' })
  @RequirePermission(Permission.BillingWrite)
  async addJobCharge(@Args('input', { type: () => AddJobChargeInput }) input: AddJobChargeInput, @CurrentUser() user: User): Promise<JobCharge> {
    const job: any = await this.jobService.findById(String(input.jobId));
    if (!job) {
      throw new NotFoundException(`Job with ID ${input.jobId} not found`);
    }
    return this.charges.addCharge({ ...input, jobId: String(job._id) }, user);
  }

  @Mutation(() => JobCharge, { description: 'Void a charge. The record is kept and struck through; issued invoices are not touched.' })
  @RequirePermission(Permission.BillingWrite)
  async voidJobCharge(@Args('id', { type: () => ID }) id: string, @Args('reason', { type: () => String }) reason: string, @CurrentUser() user: User): Promise<JobCharge> {
    return this.charges.voidCharge(id, reason, user);
  }
}
