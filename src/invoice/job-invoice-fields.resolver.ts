import { Resolver, ResolveField, Parent, Int } from '@nestjs/graphql';
import { Job } from '../job/job.model';
import { InvoiceService } from './invoice.service';

/**
 * The invoice half of a Job, resolved from the invoice module.
 *
 * It lives here rather than on `JobResolver` because `InvoiceModule` already
 * imports `JobModule` for `JobService`; adding `InvoiceService` to the job
 * resolver would close that loop and need a `forwardRef` on both sides for one
 * number.
 *
 * A count, not the invoices themselves: the jobs list renders up to 50 rows and
 * only ever asks whether a job has been invoiced yet.
 */
@Resolver(() => Job)
export class JobInvoiceFieldsResolver {
  constructor(private readonly invoiceService: InvoiceService) {}

  @ResolveField(() => Int, {
    description: 'How many invoices have been generated for this job. 0 before any billing has happened.'
  })
  async invoiceCount(@Parent() job: Job): Promise<number> {
    return this.invoiceService.countByJobId(String((job as any)._id));
  }
}
