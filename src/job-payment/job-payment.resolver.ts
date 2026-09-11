import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Inject, UseGuards, forwardRef } from '@nestjs/common';
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
import { InvoiceService } from '../invoice/invoice.service';

@Resolver(() => JobPayment)
@UseGuards(AuthRolesGuard)
export class JobPaymentResolver {
  constructor(
    private readonly payments: JobPaymentService,
    private readonly balances: JobBalanceService,
    private readonly jobService: JobService,
    private readonly notificationDispatch: NotificationDispatchService,
    // forwardRef: InvoiceModule imports this module for the balance, and this
    // resolver reissues the invoice when a payment changes it.
    @Inject(forwardRef(() => InvoiceService)) private readonly invoices: InvoiceService
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
    const amount = Number((payment as any).amount).toFixed(2);
    const reference = (payment as any).reference ? ` (${(payment as any).reference})` : '';

    // A payment changes what the invoice says, so the invoice is reissued, and
    // its announcement — which names the payment — is the one email the
    // customer gets. The receipt below is for a job with no invoice standing.
    const reissued = await this.invoices.reissueAfterPaymentChange(jobId, user, `A payment of $${amount}${reference} was received.`);
    if (reissued) return payment;

    const job: any = await this.jobService.findById(jobId);
    // After the write, so the figure the customer reads is the new one.
    const balance = await this.balances.balance(jobId);
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

  @Mutation(() => JobPayment, {
    description: 'Void a payment. The record is kept and struck through; issued invoices are not rewritten, but the current one is reissued to restate the balance.'
  })
  @RequirePermission(Permission.BillingWrite)
  async voidJobPayment(@Args('id', { type: () => ID }) id: string, @Args('reason', { type: () => String }) reason: string, @CurrentUser() user: User): Promise<JobPayment> {
    const payment = await this.payments.voidPayment(id, reason, user);
    const amount = Number((payment as any).amount).toFixed(2);
    await this.invoices.reissueAfterPaymentChange(String((payment as any).jobId), user, `A payment of $${amount} was voided (${String(reason).trim()}).`);
    return payment;
  }
}
