import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { JobPayment } from './job-payment.model';
import { JobPaymentService } from './job-payment.service';
import { JobBalanceService } from './job-balance.service';
import { JobBalance } from './dto/job-balance.type';
import { RecordJobPaymentInput } from './dto/record-job-payment.input';
import { AuthRolesGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/user.decorator';
import { User } from '../auth/user.interface';
import { RequirePermission } from '../auth/permissions/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { JobService } from '../job/job.service';
import { assertMayReadJobFinancials } from '../job/job-read-access';
import { NotificationDispatchService } from '../notification/notification-dispatch.service';

@Resolver(() => JobPayment)
@UseGuards(AuthRolesGuard)
export class JobPaymentResolver {
  constructor(
    private readonly payments: JobPaymentService,
    private readonly balances: JobBalanceService,
    private readonly jobService: JobService,
    private readonly notificationDispatch: NotificationDispatchService
  ) {}

  /**
   * Deliberately carries NO `@RequirePermission`, exactly like
   * `jobEquipmentBooking`: this loads on the customer's own job page and they
   * hold no billing permission. `assertMayReadJobFinancials` is the server-side
   * twin of the card that renders it.
   */
  @Query(() => JobBalance, { description: "A job's charges, payments and balance." })
  async jobBalance(@Args('jobId', { type: () => ID }) jobId: string, @CurrentUser() user: User): Promise<JobBalance> {
    const job = await this.jobService.findById(jobId);
    assertMayReadJobFinancials(job as any, user);
    return this.balances.balance(String((job as any)._id));
  }

  @Query(() => [JobPayment], { description: "A job's payments, voided ones included." })
  async jobPayments(@Args('jobId', { type: () => ID }) jobId: string, @CurrentUser() user: User): Promise<JobPayment[]> {
    const job = await this.jobService.findById(jobId);
    assertMayReadJobFinancials(job as any, user);
    return this.payments.findByJobId(String((job as any)._id));
  }

  @Mutation(() => JobPayment, { description: 'Record a payment received against a job.' })
  @RequirePermission(Permission.BillingWrite)
  async recordJobPayment(@Args('input', { type: () => RecordJobPaymentInput }) input: RecordJobPaymentInput, @CurrentUser() user: User): Promise<JobPayment> {
    const payment = await this.payments.record(input, user);
    const jobId = String((payment as any).jobId);
    const job: any = await this.jobService.findById(jobId);
    // After the write, so the figure the customer reads is the new one.
    const balance = await this.balances.balance(jobId);
    const amount = Number((payment as any).amount).toFixed(2);
    const reference = (payment as any).reference ? ` (${(payment as any).reference})` : '';
    this.notificationDispatch.dispatch({
      eventType: 'PAYMENT_RECORDED',
      title: `Payment of $${amount} recorded`,
      message: `A payment of $${amount}${reference} was recorded against job "${job?.name ?? jobId}". Balance now $${balance.balanceDue.toFixed(2)}.`,
      jobId,
      actorSub: user.sub,
      actorDisplayName: user.preferred_username ?? user.email ?? undefined
    });
    return payment;
  }

  @Mutation(() => JobPayment, { description: 'Void a payment. The record is kept and struck through; issued invoices are not touched.' })
  @RequirePermission(Permission.BillingWrite)
  async voidJobPayment(@Args('id', { type: () => ID }) id: string, @Args('reason', { type: () => String }) reason: string, @CurrentUser() user: User): Promise<JobPayment> {
    return this.payments.voidPayment(id, reason, user);
  }
}
