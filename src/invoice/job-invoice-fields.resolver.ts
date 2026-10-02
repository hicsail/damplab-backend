import { Resolver, ResolveField, Parent, Int } from '@nestjs/graphql';
import { Job } from '../job/job.model';
import { InvoiceService } from './invoice.service';
import { JobPaymentService } from '../job-payment/job-payment.service';
import { InvoiceStatus, invoiceStatusFromDocument, paidStatus } from './invoice-kind';

/**
 * The invoice half of a Job, resolved from the invoice module.
 *
 * It lives here rather than on `JobResolver` because `InvoiceModule` already
 * imports `JobModule` for `JobService`; adding `InvoiceService` to the job
 * resolver would close that loop and need a `forwardRef` on both sides for one
 * number.
 *
 * A status and a count, not the invoices themselves: the jobs list renders up
 * to 50 rows and only ever asks where a job's invoice stands.
 */
@Resolver(() => Job)
export class JobInvoiceFieldsResolver {
  constructor(private readonly invoiceService: InvoiceService, private readonly payments: JobPaymentService) {}

  /**
   * The same answer `Invoice.status` gives for the invoice that stands on the
   * job, so a row in the jobs list and the Invoice card it opens cannot
   * disagree. SUPERSEDED and VOID never come back: neither stands.
   */
  @ResolveField(() => InvoiceStatus, {
    nullable: true,
    description: 'Where the job’s current invoice stands — ISSUED or PAID — or null before one is issued or once it is voided.'
  })
  async invoiceStatus(@Parent() job: Job): Promise<InvoiceStatus | null> {
    const jobId = String((job as any)._id);
    const current = await this.invoiceService.findCurrent(jobId);
    if (!current) return null;
    return invoiceStatusFromDocument(current as any) ?? paidStatus(Number((current as any).subtotal) || 0, await this.payments.paymentsToDate(jobId));
  }

  @ResolveField(() => Int, {
    description: 'How many invoices stand against this job: 1 once one is issued (only the current version stands), 0 before that or once it is voided.'
  })
  async invoiceCount(@Parent() job: Job): Promise<number> {
    return this.invoiceService.countByJobId(String((job as any)._id));
  }
}
